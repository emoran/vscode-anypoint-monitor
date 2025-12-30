import * as vscode from 'vscode';

export interface Region {
    id: string;
    name: string;
    displayName: string;
    baseUrl: string;
    isDefault: boolean;
}

export const REGIONS: Region[] = [
    {
        id: 'us',
        name: 'US',
        displayName: 'US (Default)',
        baseUrl: 'https://anypoint.mulesoft.com',
        isDefault: true
    },
    {
        id: 'eu',
        name: 'EU',
        displayName: 'EU',
        baseUrl: 'https://eu1.anypoint.mulesoft.com',
        isDefault: false
    },
    {
        id: 'gov',
        name: 'GOV',
        displayName: 'GOV (GovCloud)',
        baseUrl: 'https://gov.anypoint.mulesoft.com',
        isDefault: false
    }
];

export class RegionService {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Get all available regions
     */
    getRegions(): Region[] {
        return REGIONS;
    }

    /**
     * Get a region by ID
     */
    getRegionById(regionId: string): Region | undefined {
        return REGIONS.find(r => r.id === regionId);
    }

    /**
     * Get the default region
     */
    getDefaultRegion(): Region {
        return REGIONS.find(r => r.isDefault) || REGIONS[0];
    }

    /**
     * Prompt user to select a region
     */
    async selectRegion(): Promise<Region | undefined> {
        const regionOptions = REGIONS.map(region => ({
            label: region.displayName,
            description: region.baseUrl,
            region: region
        }));

        const selected = await vscode.window.showQuickPick(regionOptions, {
            placeHolder: 'Select your Anypoint Platform control plane',
            title: 'Anypoint Platform Region Selection'
        });

        return selected?.region;
    }

    /**
     * Store region for an account
     */
    async setAccountRegion(accountId: string, regionId: string): Promise<void> {
        await this.context.secrets.store(`anypoint.account.${accountId}.region`, regionId);
    }

    /**
     * Get region for an account
     */
    async getAccountRegion(accountId: string): Promise<Region | undefined> {
        const regionId = await this.context.secrets.get(`anypoint.account.${accountId}.region`);
        return regionId ? this.getRegionById(regionId) : undefined;
    }

    /**
     * Store temporary region during new account login flow
     */
    async setTempRegion(regionId: string): Promise<void> {
        await this.context.secrets.store('anypoint.tempRegion', regionId);
    }

    /**
     * Get temporary region during new account login flow
     */
    async getTempRegion(): Promise<Region | undefined> {
        const regionId = await this.context.secrets.get('anypoint.tempRegion');
        return regionId ? this.getRegionById(regionId) : undefined;
    }

    /**
     * Clear temporary region
     */
    async clearTempRegion(): Promise<void> {
        await this.context.secrets.delete('anypoint.tempRegion');
    }

    /**
     * Get region base URL by region ID
     */
    getBaseUrlForRegion(regionId: string): string {
        const region = this.getRegionById(regionId);
        return region?.baseUrl || this.getDefaultRegion().baseUrl;
    }

    /**
     * Get authorization endpoint for a region
     */
    getAuthorizationEndpoint(regionId: string): string {
        const baseUrl = this.getBaseUrlForRegion(regionId);
        return `${baseUrl}/accounts/api/v2/oauth2/authorize`;
    }

    /**
     * Get token endpoint for a region
     */
    getTokenEndpoint(regionId: string): string {
        const baseUrl = this.getBaseUrlForRegion(regionId);
        return `${baseUrl}/accounts/api/v2/oauth2/token`;
    }

    /**
     * Get revoke endpoint for a region
     */
    getRevokeEndpoint(regionId: string): string {
        const baseUrl = this.getBaseUrlForRegion(regionId);
        return `${baseUrl}/accounts/api/v2/oauth2/revoke`;
    }
}
