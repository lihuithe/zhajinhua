// 统一的业务错误：code 供前端判断，message 为可直接展示的中文说明
export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export function err(code, message, status = 400) {
  return new AppError(code, message, status);
}
