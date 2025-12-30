/**
 * Mock data for Business Group testing
 */

import { BusinessGroup, FlatBusinessGroup } from '../../controllers/businessGroupService';

export const mockHierarchyResponse = {
    id: 'root-org-123',
    name: 'Root Organization',
    parentOrganizationIds: [],
    subOrganizationIds: ['bg-1', 'bg-2'],
    subOrganizations: [
        {
            id: 'bg-1',
            name: 'Sales Division',
            parentOrganizationIds: ['root-org-123'],
            subOrganizationIds: ['bg-1-1'],
            subOrganizations: [
                {
                    id: 'bg-1-1',
                    name: 'EMEA Sales',
                    parentOrganizationIds: ['bg-1'],
                    subOrganizationIds: [],
                    subOrganizations: []
                }
            ]
        },
        {
            id: 'bg-2',
            name: 'Engineering Division',
            parentOrganizationIds: ['root-org-123'],
            subOrganizationIds: [],
            subOrganizations: []
        }
    ]
};

export const mockParsedHierarchy: BusinessGroup = {
    id: 'root-org-123',
    name: 'Root Organization',
    isRoot: true,
    children: [
        {
            id: 'bg-1',
            name: 'Sales Division',
            parentId: 'root-org-123',
            children: [
                {
                    id: 'bg-1-1',
                    name: 'EMEA Sales',
                    parentId: 'bg-1',
                    children: []
                }
            ]
        },
        {
            id: 'bg-2',
            name: 'Engineering Division',
            parentId: 'root-org-123',
            children: []
        }
    ]
};

export const mockFlattenedHierarchy: FlatBusinessGroup[] = [
    {
        id: 'root-org-123',
        name: 'Root Organization',
        fullPath: 'Root Organization',
        level: 0,
        isRoot: true
    },
    {
        id: 'bg-1',
        name: 'Sales Division',
        fullPath: 'Root Organization > Sales Division',
        level: 1,
        parentId: 'root-org-123',
        isRoot: false
    },
    {
        id: 'bg-1-1',
        name: 'EMEA Sales',
        fullPath: 'Root Organization > Sales Division > EMEA Sales',
        level: 2,
        parentId: 'bg-1',
        isRoot: false
    },
    {
        id: 'bg-2',
        name: 'Engineering Division',
        fullPath: 'Root Organization > Engineering Division',
        level: 1,
        parentId: 'root-org-123',
        isRoot: false
    }
];

export const mockSingleBGHierarchy = {
    id: 'single-org-456',
    name: 'Single Org',
    parentOrganizationIds: [],
    subOrganizationIds: [],
    subOrganizations: []
};

export const mockEnvironmentsForRootOrg = {
    data: [
        { id: 'env-root-1', name: 'Production', organizationId: 'root-org-123', type: 'production' },
        { id: 'env-root-2', name: 'Sandbox', organizationId: 'root-org-123', type: 'sandbox' }
    ]
};

export const mockEnvironmentsForBG1 = {
    data: [
        { id: 'env-bg1-1', name: 'Sales Production', organizationId: 'bg-1', type: 'production' },
        { id: 'env-bg1-2', name: 'Sales Dev', organizationId: 'bg-1', type: 'sandbox' },
        { id: 'env-bg1-3', name: 'Sales QA', organizationId: 'bg-1', type: 'sandbox' }
    ]
};

export const mockAccount = {
    id: 'test-account-1',
    region: 'US',
    userEmail: 'test@example.com',
    organizationId: 'root-org-123',
    organizationName: 'Root Organization',
    isAuthenticated: true,
    accessToken: 'mock-token-123',
    refreshToken: 'mock-refresh-123',
    tokenExpiry: Date.now() + 3600000, // 1 hour from now
    businessGroupId: undefined,
    businessGroupName: undefined
};

export const mockAccountWithBG = {
    ...mockAccount,
    businessGroupId: 'bg-1',
    businessGroupName: 'Sales Division'
};
