from __future__ import annotations

import math
import re
from collections.abc import Sequence
from typing import Any

import httpx

from call_llm_api.domain.models import ChatMessage

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_FALLBACK_URLS = (
  OVERPASS_URL,
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
)
GROUNDER_USER_AGENT = "callLLM-location-grounder/1.0"
LOCATION_QUERY_PATTERN = re.compile(
  r"((?:[가-힣]+(?:특별시|광역시|특별자치시|도)\s+)?(?:[가-힣]+구\s+)?[가-힣0-9]+(?:동|가|읍|면|리))"
)
LOCATION_HINT_PATTERN = re.compile(r"(주변역|가까운 역|근처 역|지하철|역이 뭐|어떤 동네|동네인지)")


class LocationGrounder:
  async def build_context_documents(self, messages: Sequence[ChatMessage]) -> list[str]:
    return []

  async def maybe_build_grounded_response(self, messages: Sequence[ChatMessage]) -> dict[str, Any] | None:
    return None


class OpenStreetMapLocationGrounder(LocationGrounder):
  async def build_context_documents(self, messages: Sequence[ChatMessage]) -> list[str]:
    resolved = await self._resolve_location(messages)
    if not resolved:
      return []
    query = resolved["query"]
    place = resolved["place"]
    stations = resolved["stations"]
    station_summary = ", ".join(
      f'{station["name"]}({int(round(station["distance_m"]))}m)'
      for station in stations[:5]
    )
    documents = [
      (
        "Location lookup:\n"
        f"- Query: {query}\n"
        f'- Resolved place: {place["display_name"]}\n'
        f'- Approx coordinates: {place["lat"]:.6f}, {place["lon"]:.6f}'
      )
    ]
    if station_summary:
      documents.append(
        "Nearby subway stations from the resolved point "
        f"(approx straight-line distance): {station_summary}."
      )
      documents.append(
        "For neighborhood/station answers, prioritize only these nearby stations and say when the boundary is approximate."
      )
    return documents

  async def maybe_build_grounded_response(self, messages: Sequence[ChatMessage]) -> dict[str, Any] | None:
    resolved = await self._resolve_location(messages)
    if not resolved:
      return None

    query = resolved["query"]
    place = resolved["place"]
    stations = resolved["stations"][:4]
    neighborhood_context = self._infer_neighborhood_context(place["display_name"], stations)
    lines = [f"{query}은 {neighborhood_context}"]
    if stations:
      lines.append("")
      lines.append("가까운 지하철역(직선거리 기준 대략):")
      for station in stations:
        lines.append(f"- {station['name']}: 약 {int(round(station['distance_m']))}m")
      lines.append("")
      lines.append("참고:")
      lines.append("- 직선거리 기준이라 실제 도보 이동거리는 더 길 수 있습니다.")
      lines.append("- 동네 안에서도 위치에 따라 가장 가까운 역 체감은 조금 달라질 수 있습니다.")
    return {
      "output_text": "\n".join(lines),
      "trace": [
        {
          "event": "grounded.location_response",
          "query": query,
          "resolved_place": place["display_name"],
          "stations": stations,
        }
      ],
    }

  @staticmethod
  def _looks_like_location_query(content: str) -> bool:
    return bool(LOCATION_QUERY_PATTERN.search(content) and LOCATION_HINT_PATTERN.search(content))

  @staticmethod
  def _extract_location_query(content: str) -> str | None:
    matches = [match.group(1).strip() for match in LOCATION_QUERY_PATTERN.finditer(content)]
    if not matches:
      return None
    return max(matches, key=len)

  async def _resolve_location(self, messages: Sequence[ChatMessage]) -> dict[str, Any] | None:
    latest_user_message = next(
      (
        message.content
        for message in reversed(messages)
        if message.role == "user" and isinstance(message.content, str) and message.content.strip()
      ),
      "",
    )
    if not latest_user_message or not self._looks_like_location_query(latest_user_message):
      return None

    query = self._extract_location_query(latest_user_message)
    if not query:
      return None

    place = await self._search_place(query)
    if not place:
      return None

    stations = await self._search_nearby_subway_stations(float(place["lat"]), float(place["lon"]))
    return {
      "query": query,
      "place": place,
      "stations": stations,
    }

  @staticmethod
  def _infer_neighborhood_context(display_name: str, stations: Sequence[dict[str, Any]]) -> str:
    fragments = [fragment.strip() for fragment in display_name.split(",") if fragment.strip()]
    district = fragments[2] if len(fragments) > 2 else ""
    admin_area = fragments[1] if len(fragments) > 1 else fragments[0] if fragments else display_name
    area_hint = " ".join(part for part in [district, admin_area] if part).strip() or display_name
    if len(stations) >= 2:
      return (
        f"{area_hint} 일대의 생활권으로 볼 수 있고, 대체로 {stations[0]['name']}역과 {stations[1]['name']}역에 "
        "가까운 서울 도심 서쪽 주거·업무 혼합권으로 볼 수 있습니다."
      )
    return f"{area_hint} 일대의 생활권으로 볼 수 있습니다."

  async def _search_place(self, query: str) -> dict[str, Any] | None:
    async with httpx.AsyncClient(
      headers={"User-Agent": GROUNDER_USER_AGENT},
      timeout=httpx.Timeout(10.0, connect=5.0),
      follow_redirects=True,
    ) as client:
      response = await client.get(
        NOMINATIM_URL,
        params={"q": query, "format": "jsonv2", "limit": 1},
      )
      response.raise_for_status()
      payload = response.json()

    if not isinstance(payload, list) or len(payload) == 0 or not isinstance(payload[0], dict):
      return None
    item = payload[0]
    try:
      lat = float(item.get("lat"))
      lon = float(item.get("lon"))
    except (TypeError, ValueError):
      return None
    return {
      "display_name": str(item.get("display_name") or query),
      "lat": lat,
      "lon": lon,
    }

  async def _search_nearby_subway_stations(self, lat: float, lon: float) -> list[dict[str, Any]]:
    overpass_query = f"""
[out:json][timeout:25];
(
  node(around:1800,{lat},{lon})[railway=station];
  node(around:1800,{lat},{lon})[railway=stop];
  node(around:1800,{lat},{lon})[station=subway];
  node(around:1800,{lat},{lon})[subway=yes];
);
out body;
"""
    async with httpx.AsyncClient(
      headers={"User-Agent": GROUNDER_USER_AGENT},
      timeout=httpx.Timeout(15.0, connect=5.0),
      follow_redirects=True,
    ) as client:
      payload: dict[str, Any] | None = None
      last_error: Exception | None = None
      for endpoint in OVERPASS_FALLBACK_URLS:
        try:
          response = await client.post(endpoint, data={"data": overpass_query})
          response.raise_for_status()
          payload = response.json()
          break
        except Exception as exc:
          last_error = exc
      if payload is None:
        raise last_error or RuntimeError("Nearby station lookup failed.")

    rows: list[dict[str, Any]] = []
    for item in payload.get("elements", []):
      if not isinstance(item, dict):
        continue
      tags = item.get("tags") or {}
      if not isinstance(tags, dict):
        continue
      station_type = str(tags.get("station") or "")
      railway_type = str(tags.get("railway") or "")
      subway_flag = str(tags.get("subway") or "")
      if railway_type not in {"station", "stop"} and station_type != "subway" and subway_flag.lower() != "yes":
        continue
      name = tags.get("name") or tags.get("name:ko")
      item_lat = item.get("lat")
      item_lon = item.get("lon")
      if not isinstance(name, str) or not isinstance(item_lat, (int, float)) or not isinstance(item_lon, (int, float)):
        continue
      rows.append(
        {
          "name": name,
          "distance_m": _haversine_distance_m(lat, lon, float(item_lat), float(item_lon)),
        }
      )

    deduped: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    for row in sorted(rows, key=lambda item: item["distance_m"]):
      if row["name"] in seen_names:
        continue
      seen_names.add(row["name"])
      deduped.append(row)
    return deduped


def _haversine_distance_m(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
  radius_km = 6371.0
  dlat = math.radians(lat_b - lat_a)
  dlon = math.radians(lon_b - lon_a)
  lat_a_rad = math.radians(lat_a)
  lat_b_rad = math.radians(lat_b)
  base = (
    math.sin(dlat / 2) ** 2
    + math.cos(lat_a_rad) * math.cos(lat_b_rad) * math.sin(dlon / 2) ** 2
  )
  return radius_km * 2000 * math.atan2(math.sqrt(base), math.sqrt(1 - base))
