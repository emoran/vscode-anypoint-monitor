import * as secrets from '../config/secrets.json';


export const CLIENT_ID = secrets.CLIENT_ID;
export const CLIENT_SECRET = secrets.CLIENT_SECRET;

export const BASE_URL = 'https://anypoint.mulesoft.com';
export const AUTHORIZATION_ENDPOINT = `${BASE_URL}/accounts/api/v2/oauth2/authorize`;
export const TOKEN_ENDPOINT = `${BASE_URL}/accounts/api/v2/oauth2/token`;
export const REVOKE_ENDPOINT = `${BASE_URL}/accounts/api/v2/oauth2/revoke`;
export const LOCAL_REDIRECT_URI = 'http://localhost:8082/callback';
