import * as secrets from '../config/secrets.json';


export const CLIENT_ID = secrets.CLIENT_ID;
export const CLIENT_SECRET = secrets.CLIENT_SECRET;

export const BASE_URL = 'https://anypoint.mulesoft.com';
export const AUTHORIZATION_ENDPOINT = `${BASE_URL}/accounts/api/v2/oauth2/authorize`;
export const TOKEN_ENDPOINT = `${BASE_URL}/accounts/api/v2/oauth2/token`;
export const REVOKE_ENDPOINT = `${BASE_URL}/accounts/api/v2/oauth2/revoke`;
export const LOCAL_REDIRECT_URI = 'http://localhost:8082/callback';

// Hybrid/On-Premises Runtime Manager API Endpoints
export const HYBRID_BASE = `${BASE_URL}/hybrid/api/v1`;
export const ARM_BASE = `${BASE_URL}/armui/api/v1`;

// Hybrid Applications
export const HYBRID_APPLICATIONS_ENDPOINT = `${HYBRID_BASE}/applications`;

// Hybrid Servers
export const HYBRID_SERVERS_ENDPOINT = `${HYBRID_BASE}/servers`;

// Hybrid Server Groups
export const HYBRID_SERVER_GROUPS_ENDPOINT = `${HYBRID_BASE}/serverGroups`;

// Hybrid Clusters
export const HYBRID_CLUSTERS_ENDPOINT = `${HYBRID_BASE}/clusters`;

// Hybrid Deployments
export const HYBRID_DEPLOYMENTS_ENDPOINT = `${HYBRID_BASE}/deployments`;
