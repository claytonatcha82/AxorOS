export interface HealthResponse {
  service: 'axoros-api';
  status: 'ok';
  environment: string;
  timestamp: string;
}

export interface ApiSuccessResponse<T> {
  ok: true;
  requestId: string;
  data: T;
}

export interface ApiErrorResponse {
  ok: false;
  requestId: string;
  error: {
    code: string;
    message: string;
  };
}
