export interface AuthTokenResponse {
  token: string;
}

export interface EmailRegisterResponse {
  confirmationRequired: true;
  message: string;
}

export interface EmailConfirmResponse {
  confirmed: true;
}
