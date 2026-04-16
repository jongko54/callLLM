class AppError(Exception):
  pass


class BadRequestError(AppError):
  def __init__(self, message: str) -> None:
    super().__init__(message)
    self.message = message


class ProviderRequestError(AppError):
  def __init__(
    self,
    message: str,
    *,
    status_code: int = 502,
    retry_after_seconds: float | None = None,
  ) -> None:
    super().__init__(message)
    self.message = message
    self.status_code = status_code
    self.retry_after_seconds = retry_after_seconds


class NotFoundError(AppError):
  def __init__(self, message: str) -> None:
    super().__init__(message)
    self.message = message


class ToolExecutionError(AppError):
  def __init__(self, message: str) -> None:
    super().__init__(message)
    self.message = message
