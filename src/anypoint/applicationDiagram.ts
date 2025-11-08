import * as vscode from 'vscode';
import axios, { AxiosError } from 'axios';
import JSZip from 'jszip';
import * as fs from 'fs';

import { BASE_URL } from '../constants';
import { refreshAccessToken } from '../controllers/oauthService';
import { getCH2Deployments } from './cloudhub2Applications';
import {
    buildMermaidDefinition,
    buildMermaidDefinitionWithMode,
    buildMuleFlowGraph,
    countComponents,
    MuleFlowGraph,
    MuleFlowNode,
    selectRelevantXmlEntries
} from '../utils/muleDiagram';

interface DeploymentOption extends vscode.QuickPickItem {
    deploymentId: string;
    artifactName?: string;
    raw: any;
}

export async function showApplicationDiagram(context: vscode.ExtensionContext, environmentId: string, preselectedDeploymentId?: string): Promise<void> {
    // Create a dedicated output channel for debugging
    const outputChannel = vscode.window.createOutputChannel('Anypoint Application Diagram');
    outputChannel.show();
    outputChannel.clear();
    outputChannel.appendLine('=== Application Diagram Generation Started ===');
    outputChannel.appendLine(`Timestamp: ${new Date().toISOString()}`);
    
    // Get active account for multi-account support
    const { AccountService } = await import('../controllers/accountService.js');
    const accountService = new AccountService(context);
    const activeAccount = await accountService.getActiveAccount();
    
    if (!activeAccount) {
        outputChannel.appendLine('❌ ERROR: No active account found');
        vscode.window.showErrorMessage('No active account found. Please log in first.');
        return;
    }
    
    outputChannel.appendLine(`🔐 Active Account: ${activeAccount.userEmail} (${activeAccount.organizationName})`);
    outputChannel.appendLine(`✅ Organization ID: ${activeAccount.organizationId}`);
    outputChannel.appendLine(`✅ Environment ID: ${environmentId}`);
    
    // For backward compatibility, also check legacy user info
    const userInfoRaw = await context.secrets.get('anypoint.userInfo');
    if (userInfoRaw) {
        const { organization } = JSON.parse(userInfoRaw);
        if (organization?.id) {
            outputChannel.appendLine(`📋 Legacy Organization ID: ${organization.id}`);
        }
    }

    const deploymentChoice = await pickDeployment(context, activeAccount.organizationId, environmentId, outputChannel, preselectedDeploymentId);
    if (!deploymentChoice) {
        outputChannel.appendLine('❌ No deployment selected or available');
        return;
    }

    outputChannel.appendLine(`✅ Selected deployment: ${deploymentChoice.label} (ID: ${deploymentChoice.deploymentId})`);

    // Check if user selected local JAR file option
    if (deploymentChoice.deploymentId === '__LOCAL_JAR__') {
        outputChannel.appendLine('\n--- Local JAR File Selected ---');
        outputChannel.appendLine('💡 User chose to select a local JAR file...');
        
        // Prompt for local JAR file selection
        const localJarZip = await promptForLocalJarFile(outputChannel);
        if (!localJarZip) {
            outputChannel.appendLine('❌ No local JAR file selected, cannot generate diagram');
            return;
        }
        
        outputChannel.appendLine('✅ Using local JAR file for diagram generation');
        
        await vscode.window.withProgress({
            cancellable: false,
            location: vscode.ProgressLocation.Notification,
            title: `Generating diagram for Local JAR File`,
        }, async (progress) => {
            progress.report({ message: 'Parsing Mule configuration...' });
            const xmlFiles = await collectXmlFiles(localJarZip);
            if (Object.keys(xmlFiles).length === 0) {
                vscode.window.showWarningMessage('No Mule XML files found in the selected JAR file.');
                return;
            }

            const graph = buildMuleFlowGraph(xmlFiles);
            if (graph.nodes.length === 0) {
                vscode.window.showWarningMessage('No Mule flows detected in the selected JAR file.');
                return;
            }

            // Let user choose rendering mode
            outputChannel.appendLine(`🔍 Graph contains ${graph.nodes.length} nodes and ${graph.edges.length} edges`);
            const totalComponents = graph.nodes.reduce((sum, node) => sum + countComponents(node.components), 0);
            outputChannel.appendLine(`📊 Total components: ${totalComponents}`);
            
            await chooseRenderingMode(
                context,
                '📁 Local JAR File',
                graph,
                {
                    artifactName: 'Local JAR File',
                    fileCount: Object.keys(xmlFiles).length,
                },
                outputChannel
            );
        });
        return;
    }

    await vscode.window.withProgress({
        cancellable: false,
        location: vscode.ProgressLocation.Notification,
        title: `Generating diagram for ${deploymentChoice.label}`,
    }, async progress => {
        outputChannel.appendLine('\n--- Enriching Deployment Details ---');
        progress.report({ message: 'Fetching deployment metadata...' });
        
        const hydratedDeployment = await enrichDeploymentDetails(
            context,
            activeAccount.organizationId,
            environmentId,
            deploymentChoice.deploymentId,
            deploymentChoice.raw,
            outputChannel
        );
        
        outputChannel.appendLine('📊 Hydrated deployment metadata:');
        outputChannel.appendLine(JSON.stringify(hydratedDeployment, null, 2));

        progress.report({ message: 'Downloading application artifact...' });
        outputChannel.appendLine('\n--- Extracting Artifact Coordinates ---');
        const artifactZip = await fetchDeploymentArtifact(
            context,
            activeAccount.organizationId,
            environmentId,
            deploymentChoice.deploymentId,
            hydratedDeployment,
            outputChannel
        );
        if (!artifactZip) {
            outputChannel.appendLine('\n--- Local JAR File Fallback ---');
            outputChannel.appendLine('❌ Unable to download artifact from CloudHub or Exchange');
            outputChannel.appendLine('💡 Offering local JAR file selection...');
            
            // Offer local JAR file selection as fallback
            const localJarZip = await promptForLocalJarFile(outputChannel);
            if (!localJarZip) {
                outputChannel.appendLine('❌ No local JAR file selected, cannot generate diagram');
                return;
            }
            
            outputChannel.appendLine('✅ Using local JAR file for diagram generation');
            // Continue with the local JAR
            const xmlFiles = await collectXmlFiles(localJarZip);
            if (Object.keys(xmlFiles).length === 0) {
                vscode.window.showWarningMessage('No Mule XML files found in the selected JAR file.');
                return;
            }

            const graph = buildMuleFlowGraph(xmlFiles);
            if (graph.nodes.length === 0) {
                vscode.window.showWarningMessage('No Mule flows detected in the selected JAR file.');
                return;
            }

            const mermaid = buildMermaidDefinition(graph);
            renderDiagramWebview(context, `${deploymentChoice.label} (Local JAR)`, graph, mermaid, {
                artifactName: 'Local JAR File',
                fileCount: Object.keys(xmlFiles).length,
            });
            return;
        }

        progress.report({ message: 'Parsing Mule configuration...' });
        const xmlFiles = await collectXmlFiles(artifactZip);
        if (Object.keys(xmlFiles).length === 0) {
            vscode.window.showWarningMessage('No Mule XML files found in the application artifact.');
            return;
        }

        const graph = buildMuleFlowGraph(xmlFiles);
        if (graph.nodes.length === 0) {
            vscode.window.showWarningMessage('No Mule flows detected in the application artifact.');
            return;
        }

        const mermaid = buildMermaidDefinition(graph);
        renderDiagramWebview(context, deploymentChoice.label, graph, mermaid, {
            artifactName: deploymentChoice.artifactName,
            fileCount: Object.keys(xmlFiles).length,
        });
    });
}

async function pickDeployment(
    context: vscode.ExtensionContext,
    orgId: string,
    environmentId: string,
    outputChannel: vscode.OutputChannel,
    preselectedDeploymentId?: string
): Promise<DeploymentOption | undefined> {
    try {
        outputChannel.appendLine('\n--- Fetching Deployments ---');
        // Import and use multi-account system
        const { AccountService } = await import('../controllers/accountService.js');
        const accountService = new AccountService(context);
        
        const activeAccount = await accountService.getActiveAccount();
        if (!activeAccount) {
            outputChannel.appendLine('❌ No active account found. Please log in first.');
            throw new Error('No active account found. Please log in first.');
        }
        
        outputChannel.appendLine(`🔐 Using active account: ${activeAccount.userEmail} (${activeAccount.organizationName})`);
        outputChannel.appendLine(`🏢 Organization ID from account: ${activeAccount.organizationId}`);
        outputChannel.appendLine(`🌍 Environment ID: ${environmentId}`);
        
        // GraphQL deployment query currently has schema issues, using REST API
        outputChannel.appendLine('🔍 Using REST API for deployments (GraphQL schema validation issues)...');
        
        let deployments;
        try {
            deployments = await getCH2Deployments(context, activeAccount.organizationId, environmentId);
            outputChannel.appendLine(`📝 REST API returned ${deployments?.length || 0} deployments`);
        } catch (error: any) {
            outputChannel.appendLine(`❌ Error fetching deployments: ${error.message}`);
            
            if (error.message.includes('403') || error.message.includes('Access denied')) {
                outputChannel.appendLine('🚫 Access denied to CloudHub 2.0 for this environment');
                const action = await vscode.window.showWarningMessage(
                    `CloudHub 2.0 access denied for this environment. This might be because:

• CloudHub 2.0 is not licensed for this environment
• Your account doesn't have CloudHub 2.0 permissions
• This environment only supports CloudHub 1.0

The Application Diagram feature requires CloudHub 2.0 API access to download JAR files. You can try:`,
                    'Select Local JAR File',
                    'Try Different Environment',
                    'Cancel'
                );
                
                if (action === 'Select Local JAR File') {
                    return {
                        label: '📁 Select Local JAR File',
                        description: 'Choose a Mule application JAR file from your computer',
                        detail: 'Generate diagram from a local JAR file',
                        deploymentId: '__LOCAL_JAR__',
                        raw: null,
                    };
                }
                
                return undefined;
            } else {
                vscode.window.showErrorMessage(`Error fetching deployments: ${error.message}`);
                return undefined;
            }
        }
        
        if (!deployments || deployments.length === 0) {
            outputChannel.appendLine('❌ No deployments found in environment');
            const action = await vscode.window.showWarningMessage(
                'No CloudHub 2.0 deployments found for the selected environment. Would you like to select a local JAR file instead?',
                'Select Local JAR File',
                'Cancel'
            );
            
            if (action === 'Select Local JAR File') {
                return {
                    label: '📁 Select Local JAR File',
                    description: 'Choose a Mule application JAR file from your computer',
                    detail: 'Generate diagram from a local JAR file',
                    deploymentId: '__LOCAL_JAR__',
                    raw: null,
                };
            }
            
            return undefined;
        }

        const items: DeploymentOption[] = deployments.map((deployment: any) => {
            const runtime = deployment.currentRuntimeVersion || deployment.runtime?.version || 'runtime unknown';
            const status = deployment.status || deployment.applicationStatus || 'status unknown';
            const replicaText = deployment.replicas ? `${deployment.replicas} replicas` : undefined;
            const artifactName = deployment.artifact?.name || deployment.application?.artifact?.name;

            return {
                label: deployment.name || deployment.applicationName || deployment.application?.name || deployment.id,
                description: `${status}${replicaText ? ` · ${replicaText}` : ''}`,
                detail: `Runtime ${runtime}`,
                deploymentId: deployment.id || deployment.deploymentId,
                artifactName,
                raw: deployment,
            };
        }).sort((a, b) => a.label.localeCompare(b.label));

        // Add local JAR file option
        items.unshift({
            label: '📁 Select Local JAR File',
            description: 'Choose a Mule application JAR file from your computer',
            detail: 'Generate diagram from a local JAR file',
            deploymentId: '__LOCAL_JAR__',
            raw: null,
        });

        // If preselected deployment ID is provided, find and return it directly
        if (preselectedDeploymentId) {
            outputChannel.appendLine(`🎯 Preselected deployment ID: ${preselectedDeploymentId}`);
            const preselected = items.find(item => item.deploymentId === preselectedDeploymentId);
            if (preselected) {
                outputChannel.appendLine(`✅ Found preselected deployment: ${preselected.label}`);
                return preselected;
            } else {
                outputChannel.appendLine(`⚠️  Preselected deployment not found, showing picker...`);
            }
        }

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a CloudHub 2.0 application or local JAR file',
            matchOnDetail: true,
            matchOnDescription: true,
        });

        return pick;
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to load CloudHub 2.0 deployments: ${error.message || error}`);
        return undefined;
    }
}

async function fetchDeploymentArtifact(
    context: vscode.ExtensionContext,
    orgId: string,
    environmentId: string,
    deploymentId: string,
    deployment: any,
    outputChannel?: vscode.OutputChannel
): Promise<JSZip | undefined> {
    // Use multi-account authentication system
    const { AccountService } = await import('../controllers/accountService.js');
    const { ApiHelper } = await import('../controllers/apiHelper.js');
    const accountService = new AccountService(context);
    
    const activeAccount = await accountService.getActiveAccount();
    if (!activeAccount) {
        outputChannel?.appendLine('❌ No active account found for artifact download');
        vscode.window.showErrorMessage('No active account found. Please log in first.');
        return undefined;
    }
    
    const apiHelper = new ApiHelper(context);
    outputChannel?.appendLine(`🔐 Using account: ${activeAccount.userEmail} for artifact download`);
    outputChannel?.appendLine(`🏢 Organization: ${activeAccount.organizationName} (${activeAccount.organizationId})`);

    // IMMEDIATE GRAPHQL TEST: Try GraphQL approach for any manually deployed app
    const deploymentName = deployment?.name || deployment?.application?.name || deployment?.applicationName;
    const realAssetInfo = deployment?.application?.ref;
    
    if (realAssetInfo?.groupId && realAssetInfo?.artifactId && realAssetInfo?.version) {
        const { groupId, artifactId, version } = realAssetInfo;
        
        outputChannel?.appendLine(`🧪 TESTING: Direct GraphQL approach for manually deployed app...`);
        outputChannel?.appendLine(`📋 Deployment name: "${deploymentName}"`);
        outputChannel?.appendLine(`📋 Real asset: ${groupId}/${artifactId}/${version}`);
        
        try {
            // Make the GraphQL query using the REAL asset coordinates
            const graphqlResponse = await apiHelper.post(`${BASE_URL}/graph/api/v2/graphql`, {
                query: `
                    query asset {
                        asset(groupId:"${groupId}", assetId:"${artifactId}", version:"${version}" ) {
                            groupId
                            assetId
                            version
                            name
                            files {
                                md5
                                sha1
                                classifier
                                packaging
                                size
                                isGenerated
                                mainFile
                                externalLink
                                createdDate
                                updatedDate
                                downloadURL
                            }
                        }
                    }
                `
            });
            
            outputChannel?.appendLine(`🧪 TEST GraphQL Status: ${graphqlResponse.status}`);
            
            if (graphqlResponse.status === 200 && graphqlResponse.data?.data?.asset?.files) {
                const files = graphqlResponse.data.data.asset.files;
                outputChannel?.appendLine(`🧪 TEST: Found ${files.length} files`);
                
                files.forEach((file: any, index: number) => {
                    outputChannel?.appendLine(`🧪 File ${index + 1}: ${file.packaging}, classifier: ${file.classifier}, hasExternalLink: ${!!file.externalLink}`);
                });
                
                const jarFile = files.find((f: any) => f.packaging === 'jar' && f.externalLink);
                if (jarFile && jarFile.externalLink) {
                    outputChannel?.appendLine(`🧪 TEST: Found JAR externalLink for "${deploymentName}" (asset: ${artifactId})`);
                    outputChannel?.appendLine(`🧪 TEST: S3 URL: ${jarFile.externalLink.substring(0, 100)}...`);
                    
                    const s3Response = await axios.get(jarFile.externalLink, {
                        responseType: 'arraybuffer',
                        headers: {
                            'User-Agent': 'Anypoint-Monitor-VSCode-Extension',
                        },
                        validateStatus: status => (status ?? 0) < 500,
                    });
                    
                    if (s3Response.status === 200 && s3Response.data.byteLength > 0) {
                        outputChannel?.appendLine(`🧪 TEST SUCCESS: Downloaded JAR for "${deploymentName}" (${s3Response.data.byteLength} bytes)`);
                        return await JSZip.loadAsync(s3Response.data);
                    } else {
                        outputChannel?.appendLine(`🧪 TEST: S3 download failed with status ${s3Response.status}`);
                    }
                } else {
                    outputChannel?.appendLine(`🧪 TEST: No JAR file with externalLink found for asset ${artifactId}`);
                }
            } else {
                outputChannel?.appendLine(`🧪 TEST: GraphQL response invalid or no files found`);
            }
        } catch (testError) {
            outputChannel?.appendLine(`🧪 TEST FAILED: ${testError}`);
        }
        
        outputChannel?.appendLine(`🧪 TEST: GraphQL approach completed for "${deploymentName}", falling back to traditional method...`);
    } else {
        outputChannel?.appendLine('📋 No asset coordinates found in deployment metadata, using traditional endpoint approach...');
    }
    
    const candidateUrls = buildArtifactUrlCandidates(orgId, environmentId, deploymentId, deployment, outputChannel);
    outputChannel?.appendLine(`📋 Generated ${candidateUrls.length} direct download URL candidates:`);
    candidateUrls.forEach((url, index) => {
        outputChannel?.appendLine(`   ${index + 1}. ${url}`);
    });

    const runDownload = async (): Promise<JSZip> => {
        let lastNotFound: AxiosError | undefined;

        for (let i = 0; i < candidateUrls.length; i++) {
            const url = candidateUrls[i];
            try {
                outputChannel?.appendLine(`🔄 Trying direct download ${i + 1}/${candidateUrls.length}:`);
                outputChannel?.appendLine(`   ${url}`);
                
                // Use ApiHelper for authenticated requests with proper multi-account support
                const response = await apiHelper.get(url, {
                    headers: {
                        'Accept': 'application/java-archive, application/zip, application/octet-stream',
                        'X-ANYPNT-ORG-ID': activeAccount.organizationId,
                        'X-ANYPNT-ENV-ID': environmentId,
                        'User-Agent': 'Anypoint-Monitor-VSCode-Extension',
                    },
                    responseType: 'arraybuffer',
                    validateStatus: status => (status ?? 0) < 500,
                });

                outputChannel?.appendLine(`   📨 Response Status: ${response.status}`);
                outputChannel?.appendLine(`   📋 Response Headers:`);
                Object.entries(response.headers || {}).forEach(([key, value]) => {
                    outputChannel?.appendLine(`      ${key}: ${value}`);
                });

                if (response.status === 401) {
                    outputChannel?.appendLine(`   🔒 Unauthorized access`);
                    throw createUnauthorizedError(url);
                }

                if (response.status === 404) {
                    outputChannel?.appendLine(`   ❌ Artifact not found (404)`);
                    lastNotFound = new AxiosError(`Artifact not found at ${url}`, `${response.status}`, undefined, undefined, response);
                    continue;
                }

                if (response.status && response.status >= 300) {
                    outputChannel?.appendLine(`   ❌ Download failed with status ${response.status}`);
                    throw new AxiosError(`Failed to download artifact from ${url}`, `${response.status}`, undefined, undefined, response);
                }

                // Handle different response data types based on content-type
                const contentType = response.headers['content-type'] || '';
                let dataBuffer: ArrayBuffer;
                let dataSize: number;

                if (response.data instanceof ArrayBuffer) {
                    dataBuffer = response.data;
                    dataSize = dataBuffer.byteLength;
                } else if (typeof response.data === 'string') {
                    // Convert string to ArrayBuffer
                    const stringData = response.data as string;
                    const encoder = new TextEncoder();
                    const uint8Array = encoder.encode(stringData);
                    dataBuffer = uint8Array.buffer;
                    dataSize = stringData.length;
                } else if (response.data && typeof response.data === 'object' && 'byteLength' in response.data) {
                    // Handle other buffer-like objects
                    dataBuffer = response.data as ArrayBuffer;
                    dataSize = (response.data as any).byteLength;
                } else {
                    const fallbackString = JSON.stringify(response.data);
                    dataSize = fallbackString.length;
                    const encoder = new TextEncoder();
                    const uint8Array = encoder.encode(fallbackString);
                    dataBuffer = uint8Array.buffer;
                }

                outputChannel?.appendLine(`   ✅ Successfully downloaded artifact (${dataSize} bytes, content-type: ${contentType})`);
                
                // Check if content-type indicates HTML response (error page)
                if (contentType?.includes('text/html')) {
                    outputChannel?.appendLine(`   ❌ Server returned HTML instead of binary data - likely an error page`);
                    let htmlContent = '';
                    try {
                        if (typeof response.data === 'string') {
                            htmlContent = response.data;
                        } else {
                            htmlContent = new TextDecoder('utf-8').decode(dataBuffer);
                        }
                        outputChannel?.appendLine(`   📄 HTML Response content (first 1000 chars):`);
                        outputChannel?.appendLine(`      ${htmlContent.substring(0, 1000)}${htmlContent.length > 1000 ? '...' : ''}`);
                        
                        // Look for common error indicators in HTML
                        if (htmlContent.toLowerCase().includes('access denied') || 
                            htmlContent.toLowerCase().includes('unauthorized') ||
                            htmlContent.toLowerCase().includes('forbidden')) {
                            outputChannel?.appendLine(`   🚫 HTML indicates access/permission error`);
                        } else if (htmlContent.toLowerCase().includes('not found') || 
                                   htmlContent.toLowerCase().includes('404')) {
                            outputChannel?.appendLine(`   🔍 HTML indicates resource not found`);
                        } else {
                            outputChannel?.appendLine(`   ❓ HTML content doesn't match common error patterns`);
                        }
                    } catch (error) {
                        outputChannel?.appendLine(`   ❌ Failed to decode HTML content: ${error}`);
                    }
                    continue; // Skip trying to parse as ZIP, move to next URL
                }
                
                // Examine the response data before attempting to parse as ZIP
                if (dataSize > 0) {
                    const dataView = new DataView(dataBuffer);
                    const firstBytes = [];
                    const maxBytes = Math.min(16, dataSize);
                    for (let i = 0; i < maxBytes; i++) {
                        firstBytes.push(dataView.getUint8(i).toString(16).padStart(2, '0'));
                    }
                    outputChannel?.appendLine(`   🔍 First ${maxBytes} bytes (hex): ${firstBytes.join(' ')}`);
                    
                    // Check if this looks like a ZIP file (starts with PK signature: 50 4B)
                    const isPossibleZip = dataView.getUint8(0) === 0x50 && dataView.getUint8(1) === 0x4B;
                    outputChannel?.appendLine(`   📦 ZIP signature check: ${isPossibleZip ? 'PASS' : 'FAIL'}`);
                    
                    // Try to parse as text if it's small and might be JSON/redirect/HTML
                    if (dataSize < 10000) {
                        try {
                            let textContent: string;
                            if (typeof response.data === 'string') {
                                textContent = response.data;
                            } else {
                                textContent = new TextDecoder('utf-8').decode(dataBuffer);
                            }
                            
                            if (textContent.trim().startsWith('{') || textContent.trim().startsWith('<') || textContent.includes('html')) {
                                outputChannel?.appendLine(`   📄 Content appears to be text/JSON/XML/HTML:`);
                                outputChannel?.appendLine(`      ${textContent.substring(0, 500)}${textContent.length > 500 ? '...' : ''}`);
                            }
                        } catch {
                            outputChannel?.appendLine(`   📄 Content is not valid UTF-8 text`);
                        }
                    }
                }

                try {
                    return await JSZip.loadAsync(dataBuffer);
                } catch (zipError) {
                    outputChannel?.appendLine(`   ❌ ZIP parsing failed: ${zipError}`);
                    outputChannel?.appendLine(`   💡 This might be a redirect, metadata response, or different file format`);
                    
                    // If we got a small response that's not a ZIP, look for redirect URLs
                    if (dataSize < 10000) {
                        let textContent: string;
                        if (typeof response.data === 'string') {
                            textContent = response.data;
                        } else {
                            textContent = new TextDecoder('utf-8').decode(dataBuffer);
                        }
                        
                        let possibleRedirectUrl: string | undefined;
                        
                        // First try to parse as JSON
                        try {
                            const jsonData = JSON.parse(textContent);
                            possibleRedirectUrl = jsonData.downloadUrl || 
                                                jsonData.artifactUrl || 
                                                jsonData.url || 
                                                jsonData.location ||
                                                jsonData.href ||
                                                (jsonData.links && jsonData.links.download);
                        } catch {
                            // Not JSON, try HTML/text parsing for S3 URLs
                            outputChannel?.appendLine(`   🔍 Searching for AWS S3 URLs in HTML/text content...`);
                            
                            // Look for Exchange S3 asset manager URLs
                            const s3UrlMatch = textContent.match(/https:\/\/exchange2-asset-manager-[^.]+\.s3\.amazonaws\.com\/[^"'\s<>]+\.jar[^"'\s<>]*/);
                            if (s3UrlMatch) {
                                possibleRedirectUrl = s3UrlMatch[0];
                                outputChannel?.appendLine(`   🎯 Found Exchange S3 asset URL: ${possibleRedirectUrl}`);
                            } else {
                                // Look for any S3 JAR URLs
                                const genericS3Match = textContent.match(/https:\/\/[^.]+\.s3\.amazonaws\.com\/[^"'\s<>]+\.jar[^"'\s<>]*/);
                                if (genericS3Match) {
                                    possibleRedirectUrl = genericS3Match[0];
                                    outputChannel?.appendLine(`   🎯 Found generic S3 JAR URL: ${possibleRedirectUrl}`);
                                } else {
                                    // Look for any download URLs in href attributes or similar
                                    const hrefMatch = textContent.match(/href=["']([^"']*\.jar[^"']*?)["']/);
                                    if (hrefMatch && hrefMatch[1]) {
                                        possibleRedirectUrl = hrefMatch[1];
                                        outputChannel?.appendLine(`   🎯 Found href download URL: ${possibleRedirectUrl}`);
                                    }
                                }
                            }
                        }
                        
                        if (possibleRedirectUrl && typeof possibleRedirectUrl === 'string') {
                            outputChannel?.appendLine(`   🔗 Found potential redirect URL: ${possibleRedirectUrl}`);
                            
                            // Try to download from the redirect URL
                            try {
                                outputChannel?.appendLine(`   🔄 Attempting download from redirect URL...`);
                                const redirectResponse = await axios.get<ArrayBuffer>(possibleRedirectUrl, {
                                    headers: {
                                        // S3 URLs use presigned access, no auth needed
                                        'User-Agent': 'Anypoint-Monitor-VSCode-Extension',
                                    },
                                    responseType: 'arraybuffer',
                                    validateStatus: status => (status ?? 0) < 500,
                                });
                                
                                if (redirectResponse.status === 200 && redirectResponse.data.byteLength > 0) {
                                    outputChannel?.appendLine(`   ✅ Successfully downloaded from redirect (${redirectResponse.data.byteLength} bytes)`);
                                    return await JSZip.loadAsync(redirectResponse.data);
                                }
                            } catch (redirectError) {
                                outputChannel?.appendLine(`   ❌ Redirect download failed: ${redirectError}`);
                            }
                        }
                    }
                    
                    throw zipError;
                }
            } catch (error: unknown) {
                if (isUnauthorized(error)) {
                    throw error;
                }

                if (axios.isAxiosError(error) && error.response?.status === 404) {
                    outputChannel?.appendLine(`   ❌ 404 Not Found`);
                    lastNotFound = error;
                    continue;
                }

                outputChannel?.appendLine(`   ❌ Exception: ${error}`);
                throw error;
            }
        }

        /* DISABLED: Try direct GraphQL approach for moran-data-generator-api before anything else
        if (deployment?.application?.ref?.artifactId === 'moran-data-generator-api') {
            outputChannel?.appendLine('🧪 TESTING: Direct GraphQL approach for moran-data-generator-api...');
            
            try {
                // Make the GraphQL query directly to get fresh S3 URL
                const graphqlResponse = await axios.post(`${BASE_URL}/graph/api/v2/graphql`, {
                    query: `
                        query asset {
                            asset(groupId:"37c16704-6187-4f8f-87eb-e3263c3852fa", assetId:"moran-data-generator-api", version:"1.0.0" ) {
                                groupId
                                assetId
                                version
                                name
                                files {
                                    md5
                                    sha1
                                    classifier
                                    packaging
                                    size
                                    isGenerated
                                    mainFile
                                    externalLink
                                    createdDate
                                    updatedDate
                                    downloadURL
                                }
                            }
                        }
                    `
                }, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'X-ANYPNT-ORG-ID': orgId,
                    }
                });
                
                outputChannel?.appendLine(`🧪 TEST GraphQL Status: ${graphqlResponse.status}`);
                
                if (graphqlResponse.status === 200 && graphqlResponse.data?.data?.asset?.files) {
                    const files = graphqlResponse.data.data.asset.files;
                    outputChannel?.appendLine(`🧪 TEST: Found ${files.length} files`);
                    
                    files.forEach((file: any, index: number) => {
                        outputChannel?.appendLine(`🧪 File ${index + 1}: ${file.packaging}, classifier: ${file.classifier}, hasExternalLink: ${!!file.externalLink}`);
                    });
                    
                    const jarFile = files.find((f: any) => f.packaging === 'jar' && f.externalLink);
                    if (jarFile && jarFile.externalLink) {
                        outputChannel?.appendLine(`🧪 TEST: Found JAR externalLink: ${jarFile.externalLink.substring(0, 100)}...`);
                        
                        const s3Response = await axios.get(jarFile.externalLink, {
                            responseType: 'arraybuffer',
                            headers: {
                                'User-Agent': 'Anypoint-Monitor-VSCode-Extension',
                            },
                            validateStatus: status => (status ?? 0) < 500,
                        });
                        
                        if (s3Response.status === 200 && s3Response.data.byteLength > 0) {
                            outputChannel?.appendLine(`🧪 TEST SUCCESS: Downloaded JAR (${s3Response.data.byteLength} bytes)`);
                            return await JSZip.loadAsync(s3Response.data);
                        }
                    }
                }
            } catch (testError) {
                outputChannel?.appendLine(`🧪 TEST FAILED: ${testError}`);
            }
        }
        */

        // For CloudHub 2.0, try Exchange GraphQL API first to get S3 presigned URLs
        outputChannel?.appendLine('🔍 Extracting artifact coordinates from deployment metadata...');
        console.log('🔍 DEPLOYMENT DATA FOR COORDINATE EXTRACTION:', JSON.stringify(deployment, null, 2));
        const coords = extractArtifactCoordinates(deployment, outputChannel);
        console.log('🎯 EXTRACTED COORDINATES:', coords);
        
        // Enhanced coordinate extraction with intelligent fallbacks
        let finalCoords = coords;
        
        // Smart coordinate inference for known deployment patterns
        if (!finalCoords) {
            const deploymentName = deployment?.name || deployment?.application?.name;
            outputChannel?.appendLine(`🤔 No coordinates extracted, trying smart inference for deployment: ${deploymentName}`);

            if (deploymentName) {
                // Remove common suffixes to get asset name
                const assetName = deploymentName
                    .replace(/-ch2$/, '')  // Remove CloudHub 2.0 suffix
                    .replace(/-ch1$/, '')  // Remove CloudHub 1.0 suffix
                    .replace(/-sbx$/, '')  // Remove sandbox suffix
                    .replace(/-prod$/, '') // Remove production suffix
                    .replace(/-dev$/, '')  // Remove development suffix
                    .replace(/-test$/, '') // Remove test suffix
                    .replace(/-v\d+$/, ''); // Remove version suffix

                // Use organization ID as groupId (common pattern)
                finalCoords = {
                    groupId: activeAccount.organizationId,
                    assetId: assetName,
                    version: '1.0.0' // Default version
                };

                outputChannel?.appendLine(`💡 Inferred coordinates: ${JSON.stringify(finalCoords, null, 2)}`);
                console.log('💡 SMART INFERRED COORDINATES:', finalCoords);
            }
        }
        
        if (finalCoords) {
            try {
                outputChannel?.appendLine(`🎯 Using artifact coordinates: ${JSON.stringify(finalCoords, null, 2)}`);

                // PRIORITY 1: Try Maven Facade API first (CloudHub 2.0 specific, direct download)
                outputChannel?.appendLine('\n=== PRIORITY 1: Maven Facade API ===');
                const mavenZip = await downloadFromMavenFacade(
                    finalCoords,
                    activeAccount.organizationId,
                    environmentId,
                    context,
                    outputChannel
                );

                if (mavenZip) {
                    outputChannel?.appendLine('✅ SUCCESS: Downloaded artifact from Maven Facade API');
                    return mavenZip;
                } else {
                    outputChannel?.appendLine('⚠️  Maven Facade API download failed, trying alternative methods...');
                }

                /* DISABLED: Original GraphQL approach (if test above didn't work)
                if (finalCoords.assetId === 'moran-data-generator-api' && finalCoords.groupId === '37c16704-6187-4f8f-87eb-e3263c3852fa') {
                    outputChannel?.appendLine('🧪 TESTING: Using hardcoded approach for moran-data-generator-api...');
                    
                    try {
                        // Make the GraphQL query directly to get fresh S3 URL
                        const graphqlResponse = await axios.post(`${BASE_URL}/graph/api/v2/graphql`, {
                            query: `
                                query asset {
                                    asset(groupId:"37c16704-6187-4f8f-87eb-e3263c3852fa", assetId:"moran-data-generator-api", version:"1.0.0" ) {
                                        groupId
                                        assetId
                                        version
                                        name
                                        files {
                                            md5
                                            sha1
                                            classifier
                                            packaging
                                            size
                                            isGenerated
                                            mainFile
                                            externalLink
                                            createdDate
                                            updatedDate
                                            downloadURL
                                        }
                                    }
                                }
                            `
                        }, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json',
                                'X-ANYPNT-ORG-ID': orgId,
                            }
                        });
                        
                        outputChannel?.appendLine(`🧪 TEST GraphQL Status: ${graphqlResponse.status}`);
                        
                        if (graphqlResponse.status === 200 && graphqlResponse.data?.data?.asset?.files) {
                            const files = graphqlResponse.data.data.asset.files;
                            outputChannel?.appendLine(`🧪 TEST: Found ${files.length} files`);
                            
                            const jarFile = files.find((f: any) => f.packaging === 'jar' && f.externalLink);
                            if (jarFile && jarFile.externalLink) {
                                outputChannel?.appendLine(`🧪 TEST: Found JAR externalLink: ${jarFile.externalLink}`);
                                
                                const s3Response = await axios.get<ArrayBuffer>(jarFile.externalLink, {
                                    responseType: 'arraybuffer',
                                    headers: {
                                        'User-Agent': 'Anypoint-Monitor-VSCode-Extension',
                                    },
                                    validateStatus: status => (status ?? 0) < 500,
                                });
                                
                                if (s3Response.status === 200 && s3Response.data.byteLength > 0) {
                                    outputChannel?.appendLine(`🧪 TEST SUCCESS: Downloaded JAR (${s3Response.data.byteLength} bytes)`);
                                    return await JSZip.loadAsync(s3Response.data);
                                }
                            }
                        }
                    } catch (testError) {
                        outputChannel?.appendLine(`🧪 TEST FAILED: ${testError}`);
                    }
                }
                */

                // Try GraphQL approach to get S3 presigned download URL
                outputChannel?.appendLine('🔗 Attempting GraphQL asset download URL retrieval...');
                outputChannel?.appendLine(`📍 Using coordinates: groupId=${finalCoords.groupId}, assetId=${finalCoords.assetId}, version=${finalCoords.version}`);
                console.log('🔗 CALLING GraphQL asset download with coordinates:', finalCoords);
                const s3DownloadUrl = await getAssetDownloadUrlFromGraphQL(finalCoords, activeAccount.organizationId, context, outputChannel);
                console.log('📍 GraphQL asset download result:', s3DownloadUrl);
                outputChannel?.appendLine(`📍 GraphQL result: ${s3DownloadUrl ? 'SUCCESS - URL found' : 'FAILED - No URL returned'}`);
                if (s3DownloadUrl) {
                    outputChannel?.appendLine(`🎯 Found S3 download URL from GraphQL: ${s3DownloadUrl}`);
                    
                    try {
                        outputChannel?.appendLine('📥 Downloading from S3 presigned URL...');
                        const s3Response = await axios.get<ArrayBuffer>(s3DownloadUrl, {
                            responseType: 'arraybuffer',
                            headers: {
                                'User-Agent': 'Anypoint-Monitor-VSCode-Extension',
                            },
                            validateStatus: status => (status ?? 0) < 500,
                        });
                        
                        if (s3Response.status === 200 && s3Response.data.byteLength > 0) {
                            outputChannel?.appendLine(`✅ Successfully downloaded from S3 (${s3Response.data.byteLength} bytes)`);
                            return await JSZip.loadAsync(s3Response.data);
                        }
                    } catch (s3Error) {
                        outputChannel?.appendLine(`❌ S3 download failed: ${s3Error}`);
                    }
                }
                
                // Fallback to traditional Exchange download
                outputChannel?.appendLine('📥 Attempting traditional Exchange artifact download...');
                const exchangeData = await downloadArtifactFromExchange(finalCoords, activeAccount.organizationId, context, outputChannel);
                if (exchangeData) {
                    outputChannel?.appendLine('✅ Successfully downloaded artifact from Exchange');
                    return await JSZip.loadAsync(exchangeData);
                }
                
                // If both GraphQL and Exchange failed, likely a manually deployed application
                outputChannel?.appendLine('🔍 No asset found in Exchange - likely a manually deployed application');
                outputChannel?.appendLine('💡 Skipping 44-endpoint attempts and offering local JAR selection...');
                
                // Immediately offer local JAR selection for manually deployed apps
                const localJarZip = await promptForLocalJarFile(outputChannel);
                if (localJarZip) {
                    outputChannel?.appendLine('✅ Using local JAR file for manually deployed application');
                    return localJarZip;
                }
                return undefined;
                
            } catch (exchangeError) {
                outputChannel?.appendLine(`❌ Exchange artifact download failed: ${exchangeError}`);
                outputChannel?.appendLine('🔄 Will try direct deployment endpoints...');
            }
        } else {
            outputChannel?.appendLine('❌ No artifact coordinates found, trying direct deployment endpoints');
        }

        outputChannel?.appendLine('\n--- Direct CloudHub Artifact Download ---');
        outputChannel?.appendLine('🔍 Trying direct CloudHub deployment artifact endpoints...');

        if (lastNotFound) {
            throw lastNotFound;
        }

        // FINAL FALLBACK: Manual deployment detection with JAR filename approach
        outputChannel?.appendLine('\n--- Manual Deployment Detection (Final Fallback) ---');
        outputChannel?.appendLine('🔍 All automatic download methods failed, trying manual deployment detection...');
        
        const manualDeploymentName = deployment?.name || deployment?.application?.name;
        if (manualDeploymentName) {
            outputChannel?.appendLine(`🔍 Application name: ${manualDeploymentName}`);
            outputChannel?.appendLine('🤔 This might be a manually deployed application, trying JAR filename approach...');
            
            // Try to get JAR filename from deployment configuration or runtime
            let jarFilename: string | undefined;
            
            // Look for JAR filename in various possible locations
            if (deployment?.application?.filename) {
                jarFilename = deployment.application.filename;
                outputChannel?.appendLine(`📄 Found JAR filename in deployment.application.filename: ${jarFilename}`);
            } else if (deployment?.application?.artifactFilename) {
                jarFilename = deployment.application.artifactFilename;
                outputChannel?.appendLine(`📄 Found JAR filename in deployment.application.artifactFilename: ${jarFilename}`);
            } else if (deployment?.application?.fileName) {
                jarFilename = deployment.application.fileName;
                outputChannel?.appendLine(`📄 Found JAR filename in deployment.application.fileName: ${jarFilename}`);
            } else if (deployment?.application?.artifact?.fileName) {
                jarFilename = deployment.application.artifact.fileName;
                outputChannel?.appendLine(`📄 Found JAR filename in deployment.application.artifact.fileName: ${jarFilename}`);
            } else if (deployment?.application?.ref?.artifactId) {
                jarFilename = deployment.application.ref.artifactId + '.jar';
                outputChannel?.appendLine(`📄 Constructed JAR filename from deployment.application.ref.artifactId: ${jarFilename}`);
            } else if (deployment?.target?.deployments?.[0]?.application?.ref?.artifactId) {
                jarFilename = deployment.target.deployments[0].application.ref.artifactId + '.jar';
                outputChannel?.appendLine(`📄 Constructed JAR filename from target.deployments.application.ref.artifactId: ${jarFilename}`);
            } else if (deployment?.target?.artifact?.fileName) {
                jarFilename = deployment.target.artifact.fileName;
                outputChannel?.appendLine(`📄 Found JAR filename in deployment.target.artifact.fileName: ${jarFilename}`);
            } else {
                // Try to extract from deployment name as last resort
                if (manualDeploymentName) {
                    jarFilename = manualDeploymentName + '.jar';
                    outputChannel?.appendLine(`📄 Fallback: using deployment name as JAR filename: ${jarFilename}`);
                }
            }
            
            // If we have a JAR filename, try using it as assetId in GraphQL
            if (jarFilename) {
                const assetIdFromJar = jarFilename.replace(/\.jar$/, ''); // Remove .jar extension
                outputChannel?.appendLine(`🧪 Trying GraphQL with JAR filename as assetId: ${assetIdFromJar}`);
                
                try {
                    const graphqlQuery = {
                        query: `
                            query asset {
                                asset(groupId:"${activeAccount.organizationId}", assetId:"${assetIdFromJar}", version:"1.0.0" ) {
                                    groupId
                                    assetId
                                    version
                                    name
                                    files {
                                        md5
                                        sha1
                                        classifier
                                        packaging
                                        size
                                        isGenerated
                                        mainFile
                                        externalLink
                                        createdDate
                                        updatedDate
                                        downloadURL
                                    }
                                }
                            }
                        `
                    };
                    
                    const graphqlResponse = await apiHelper.post(`${BASE_URL}/graph/api/v2/graphql`, graphqlQuery);
                    
                    if (graphqlResponse.data?.data?.asset?.files) {
                        const jarFile = graphqlResponse.data.data.asset.files.find((file: any) => 
                            file.packaging === 'jar' && file.classifier === 'mule-application'
                        );
                        
                        if (jarFile?.downloadURL) {
                            outputChannel?.appendLine(`✅ Found JAR via GraphQL! Downloading from: ${jarFile.downloadURL}`);
                            
                            try {
                                const jarResponse = await apiHelper.get(jarFile.downloadURL, { responseType: 'arraybuffer' });
                                if (jarResponse.status === 200 && jarResponse.data.byteLength > 0) {
                                    outputChannel?.appendLine(`✅ Successfully downloaded JAR (${jarResponse.data.byteLength} bytes)`);
                                    return await JSZip.loadAsync(jarResponse.data);
                                }
                            } catch (downloadError) {
                                outputChannel?.appendLine(`❌ Failed to download from GraphQL URL: ${downloadError}`);
                            }
                        }
                    }
                } catch (graphqlError) {
                    outputChannel?.appendLine(`❌ GraphQL query with JAR filename failed: ${graphqlError}`);
                }
            }
            
            outputChannel?.appendLine('💡 Manual deployment detection failed, offering local JAR selection...');
            
            // Offer local JAR selection as final fallback
            const localJarZip = await promptForLocalJarFile(outputChannel);
            if (localJarZip) {
                outputChannel?.appendLine('✅ Using local JAR file for manually deployed application');
                return localJarZip;
            }
        }

        throw new Error('Unable to locate artifact for the selected deployment.');
    };

    try {
        return await runDownload();
    } catch (error: unknown) {
        // ApiHelper handles token refresh automatically, so we don't need manual retry logic
        outputChannel?.appendLine(`❌ Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        reportDownloadError(error, candidateUrls);
        return undefined;
    }
}

async function getAssetDownloadUrlFromGraphQL(
    coords: ArtifactCoordinates,
    orgId: string,
    context: vscode.ExtensionContext,
    outputChannel?: vscode.OutputChannel
): Promise<string | undefined> {
    outputChannel?.appendLine(`🚀 STARTING GraphQL asset download URL retrieval`);
    outputChannel?.appendLine(`📊 Input: groupId=${coords.groupId}, assetId=${coords.assetId}, version=${coords.version}, orgId=${orgId}`);
    
    // Get access token from active account
    const { AccountService } = await import('../controllers/accountService.js');
    const accountService = new AccountService(context);
    const accessToken = await accountService.getActiveAccountAccessToken();
    if (!accessToken) {
        outputChannel?.appendLine('❌ No access token available for GraphQL request');
        return undefined;
    }
    
    const graphqlEndpoint = `${BASE_URL}/graph/api/v2/graphql`;
    
    outputChannel?.appendLine(`📡 GraphQL Asset Endpoint: ${graphqlEndpoint}`);
    
    // GraphQL query to get asset download URL - using exact field names from actual response
    const query = `
        query GetAssetDownloadUrl($groupId: String!, $assetId: String!, $version: String!) {
            asset(groupId: $groupId, assetId: $assetId, version: $version) {
                groupId
                assetId
                version
                name
                files {
                    md5
                    sha1
                    classifier
                    packaging
                    size
                    isGenerated
                    mainFile
                    externalLink
                    createdDate
                    updatedDate
                    downloadURL
                }
            }
        }
    `;

    const variables = {
        groupId: coords.groupId,
        assetId: coords.assetId,
        version: coords.version
    };

    outputChannel?.appendLine(`🔍 GraphQL Variables: ${JSON.stringify(variables, null, 2)}`);

    try {
        const response = await axios.post(graphqlEndpoint, {
            query,
            variables
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-ANYPNT-ORG-ID': orgId,
                'User-Agent': 'Anypoint-Monitor-VSCode-Extension',
            },
            validateStatus: status => (status ?? 0) < 500,
        });

        outputChannel?.appendLine(`📨 GraphQL Response Status: ${response.status}`);

        if (response.status !== 200) {
            outputChannel?.appendLine(`❌ GraphQL request failed with status ${response.status}`);
            return undefined;
        }

        const data = response.data;
        console.log('🎯 ASSET GRAPHQL RESPONSE (contains JAR URLs):', JSON.stringify(data, null, 2));
        outputChannel?.appendLine(`📊 GraphQL Response: ${JSON.stringify(data, null, 2)}`);

        if (data.errors && data.errors.length > 0) {
            outputChannel?.appendLine(`❌ GraphQL errors: ${JSON.stringify(data.errors, null, 2)}`);
            return undefined;
        }

        if (!data.data || !data.data.asset) {
            outputChannel?.appendLine(`❌ No asset data found in GraphQL response`);
            return undefined;
        }

        const asset = data.data.asset;
        outputChannel?.appendLine(`📋 Asset found: ${asset.name} (${asset.groupId}/${asset.assetId}/${asset.version})`);

        // Look for download URL in files (prioritize JAR files with S3 externalLink)
        if (asset.files && Array.isArray(asset.files)) {
            outputChannel?.appendLine(`🔍 Searching ${asset.files.length} files for download URLs...`);
            
            // Debug: log all files
            asset.files.forEach((file: any, index: number) => {
                outputChannel?.appendLine(`  File ${index + 1}: ${file.packaging || 'no-packaging'}, classifier: ${file.classifier || 'none'}, externalLink: ${file.externalLink ? 'YES' : 'NO'}, downloadURL: ${file.downloadURL ? 'YES' : 'NO'}`);
            });
            
            // First, look for JAR files with externalLink (S3 presigned URL)
            const jarFileWithS3 = asset.files.find((file: any) => 
                file.packaging === 'jar' && 
                file.classifier === 'mule-application' &&
                file.externalLink && 
                file.externalLink.includes('s3.amazonaws.com')
            );
            
            outputChannel?.appendLine(`🔍 JAR with S3 search result: ${jarFileWithS3 ? 'FOUND' : 'NOT FOUND'}`);

            if (jarFileWithS3 && jarFileWithS3.externalLink) {
                outputChannel?.appendLine(`🎯 Found JAR file S3 externalLink: ${jarFileWithS3.externalLink}`);
                return jarFileWithS3.externalLink;
            }

            // Second, look for any JAR file with externalLink
            const jarFileWithExternal = asset.files.find((file: any) => 
                file.packaging === 'jar' && file.externalLink
            );
            
            outputChannel?.appendLine(`🔍 Any JAR with externalLink search result: ${jarFileWithExternal ? 'FOUND' : 'NOT FOUND'}`);

            if (jarFileWithExternal && jarFileWithExternal.externalLink) {
                outputChannel?.appendLine(`🎯 Found JAR file externalLink: ${jarFileWithExternal.externalLink}`);
                return jarFileWithExternal.externalLink;
            }

            // Third, look for JAR files with downloadURL (Exchange API endpoint)
            const jarFileWithDownload = asset.files.find((file: any) => 
                file.packaging === 'jar' && file.downloadURL
            );

            if (jarFileWithDownload && jarFileWithDownload.downloadURL) {
                outputChannel?.appendLine(`🎯 Found JAR file downloadURL: ${jarFileWithDownload.downloadURL}`);
                return jarFileWithDownload.downloadURL;
            }

            // Fallback: any file with externalLink
            const fileWithExternal = asset.files.find((file: any) => file.externalLink);
            if (fileWithExternal && fileWithExternal.externalLink) {
                outputChannel?.appendLine(`🎯 Found file externalLink: ${fileWithExternal.externalLink}`);
                return fileWithExternal.externalLink;
            }

            // Final fallback: any file with downloadURL
            const fileWithDownload = asset.files.find((file: any) => file.downloadURL);
            if (fileWithDownload && fileWithDownload.downloadURL) {
                outputChannel?.appendLine(`🎯 Found file downloadURL: ${fileWithDownload.downloadURL}`);
                return fileWithDownload.downloadURL;
            }
            
            // Emergency fallback: Just grab the first JAR file's externalLink if it exists
            const anyJarFile = asset.files.find((file: any) => file.packaging === 'jar');
            if (anyJarFile) {
                outputChannel?.appendLine(`🆘 Emergency: Found JAR file, externalLink exists: ${anyJarFile.externalLink ? 'YES' : 'NO'}`);
                if (anyJarFile.externalLink) {
                    outputChannel?.appendLine(`🆘 Emergency: Using JAR externalLink: ${anyJarFile.externalLink}`);
                    return anyJarFile.externalLink;
                }
                if (anyJarFile.downloadURL) {
                    outputChannel?.appendLine(`🆘 Emergency: Using JAR downloadURL: ${anyJarFile.downloadURL}`);
                    return anyJarFile.downloadURL;
                }
            }
        }

        outputChannel?.appendLine(`❌ No download URL found in GraphQL asset response`);
        return undefined;

    } catch (error: any) {
        outputChannel?.appendLine(`❌ GraphQL asset request failed: ${error.message || error}`);
        return undefined;
    }
}

async function getCH2DeploymentsGraphQL(
    context: vscode.ExtensionContext,
    orgId: string,
    environmentId: string,
    outputChannel?: vscode.OutputChannel
): Promise<any[]> {
    const graphqlEndpoint = `${BASE_URL}/graph/api/v2/graphql`;
    
    outputChannel?.appendLine(`📡 GraphQL Endpoint: ${graphqlEndpoint}`);
    
    // Use ApiHelper for automatic token management
    const { ApiHelper } = await import('../controllers/apiHelper.js');
    const apiHelper = new ApiHelper(context);
    
    outputChannel?.appendLine('✅ Using ApiHelper for authenticated GraphQL request');

    // GraphQL query to get deployments with artifact information
    const query = `
        query GetDeployments($orgId: String!, $envId: String!) {
            deployments(organizationId: $orgId, environmentId: $envId) {
                items {
                    id
                    name
                    status
                    organizationId
                    environmentId
                    currentRuntimeVersion
                    applicationId
                    applicationName
                    replicas
                    application {
                        id
                        name
                        artifact {
                            groupId
                            assetId
                            version
                            classifier
                            packaging
                            uri
                            downloadUrl
                        }
                    }
                    target {
                        artifact {
                            groupId
                            assetId
                            version
                            classifier
                            packaging
                            uri
                            downloadUrl
                        }
                    }
                    appliedConfiguration {
                        artifact {
                            groupId
                            assetId
                            version
                            classifier
                            packaging
                            uri
                            downloadUrl
                        }
                    }
                }
            }
        }
    `;

    const variables = {
        orgId,
        envId: environmentId
    };

    try {
        outputChannel?.appendLine(`🚀 Sending GraphQL deployments query...`);
        outputChannel?.appendLine(`Variables: orgId=${orgId}, envId=${environmentId}`);
        
        let response = await apiHelper.post(graphqlEndpoint, {
            query,
            variables
        }, {
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-ANYPNT-ORG-ID': orgId,
                'X-ANYPNT-ENV-ID': environmentId,
            },
            validateStatus: () => true,
        });
        
        outputChannel?.appendLine(`📨 GraphQL Response Status: ${response.status}`);
        

        if (response.status >= 400) {
            outputChannel?.appendLine(`❌ GraphQL request failed with status ${response.status}`);
            outputChannel?.appendLine(`Response: ${JSON.stringify(response.data, null, 2)}`);
            return [];
        }

        if (response.data?.errors) {
            outputChannel?.appendLine('❌ GraphQL errors:');
            outputChannel?.appendLine(JSON.stringify(response.data.errors, null, 2));
            return [];
        }

        const deployments = response.data?.data?.deployments?.items || [];
        outputChannel?.appendLine(`📊 GraphQL returned ${deployments.length} deployments`);
        
        if (deployments.length > 0) {
            outputChannel?.appendLine('📝 Sample deployment data:');
            outputChannel?.appendLine(JSON.stringify(deployments[0], null, 2));
        }
        
        return deployments;
    } catch (error: unknown) {
        outputChannel?.appendLine(`❌ GraphQL request exception: ${error}`);
        if (error instanceof Error) {
            outputChannel?.appendLine(`Error details: ${error.message}`);
            outputChannel?.appendLine(`Stack: ${error.stack}`);
        }
        return [];
    }
}

async function collectXmlFiles(zip: JSZip): Promise<Record<string, string>> {
    const entries: Array<{ path: string; content: string }> = [];

    const promises: Promise<void>[] = [];
    zip.forEach((relativePath, file) => {
        if (file.dir) {
            return;
        }
        promises.push(
            file.async('string').then(content => {
                entries.push({ path: relativePath, content });
            })
        );
    });

    await Promise.all(promises);
    return selectRelevantXmlEntries(entries);
}

interface ArtifactCoordinates {
    groupId: string;
    assetId: string;
    version: string;
    classifier?: string;
    packaging?: string;
}

/**
 * Builds the Maven Facade API download URL for CloudHub 2.0 applications
 * @param organizationId - The organization ID
 * @param groupId - Maven group ID (often the organization ID or custom group)
 * @param artifactId - Maven artifact ID (application name)
 * @param version - Application version
 * @returns Complete Maven download URL
 */
function buildMavenDownloadUrl(
    organizationId: string,
    groupId: string,
    artifactId: string,
    version: string
): string {
    // Convert Group ID dots to slashes for Maven path format
    const groupPath = groupId.replace(/\./g, '/');

    // Build the JAR filename: {artifactId}-{version}-mule-application.jar
    const jarFileName = `${artifactId}-${version}-mule-application.jar`;

    // Construct the complete Maven Facade URL
    // Format: https://maven.anypoint.mulesoft.com/api/v3/organizations/{ORG_ID}/maven/{GROUP_PATH}/{ARTIFACT_ID}/{VERSION}/{JAR_FILENAME}
    return `https://maven.anypoint.mulesoft.com/api/v3/organizations/${organizationId}/maven/${groupPath}/${artifactId}/${version}/${jarFileName}`;
}

/**
 * Downloads application JAR from Maven Facade API (CloudHub 2.0)
 * @param coordinates - Artifact coordinates (groupId, artifactId, version)
 * @param organizationId - Organization ID
 * @param environmentId - Environment ID
 * @param context - VSCode extension context for authentication
 * @param outputChannel - Output channel for logging
 * @returns JSZip object if successful, undefined otherwise
 */
async function downloadFromMavenFacade(
    coordinates: ArtifactCoordinates,
    organizationId: string,
    environmentId: string,
    context: vscode.ExtensionContext,
    outputChannel?: vscode.OutputChannel
): Promise<JSZip | undefined> {
    const { groupId, assetId, version } = coordinates;

    outputChannel?.appendLine('\n--- Maven Facade API Download ---');
    outputChannel?.appendLine('🔗 Attempting CloudHub 2.0 Maven Facade API download...');
    outputChannel?.appendLine(`📋 Coordinates: groupId=${groupId}, artifactId=${assetId}, version=${version}`);

    // Build the Maven download URL
    const mavenUrl = buildMavenDownloadUrl(organizationId, groupId, assetId, version);
    outputChannel?.appendLine(`🎯 Maven URL: ${mavenUrl}`);

    try {
        // Use ApiHelper for authenticated requests with proper multi-account support
        const { ApiHelper } = await import('../controllers/apiHelper.js');
        const apiHelper = new ApiHelper(context);

        outputChannel?.appendLine('📥 Downloading from Maven Facade API...');
        const response = await apiHelper.get(mavenUrl, {
            headers: {
                'Accept': 'application/java-archive, application/zip, application/octet-stream',
                'X-ANYPNT-ORG-ID': organizationId,
                'X-ANYPNT-ENV-ID': environmentId,
            },
            responseType: 'arraybuffer',
            validateStatus: status => (status ?? 0) < 500,
        });

        outputChannel?.appendLine(`📨 Response Status: ${response.status}`);

        if (response.status === 200 && response.data) {
            const dataSize = response.data.byteLength || response.data.length;
            outputChannel?.appendLine(`✅ Successfully downloaded from Maven (${dataSize} bytes)`);

            // Verify it's a valid ZIP/JAR file
            if (dataSize > 0) {
                try {
                    const zip = await JSZip.loadAsync(response.data);
                    outputChannel?.appendLine(`✅ Successfully loaded JAR/ZIP with ${Object.keys(zip.files).length} files`);
                    return zip;
                } catch (zipError) {
                    outputChannel?.appendLine(`❌ Downloaded file is not a valid ZIP/JAR: ${zipError}`);
                }
            } else {
                outputChannel?.appendLine('❌ Downloaded file is empty');
            }
        } else if (response.status === 404) {
            outputChannel?.appendLine('❌ Artifact not found in Maven repository (404)');
            outputChannel?.appendLine('💡 This might be a manually deployed application not stored in Exchange');
        } else if (response.status === 401 || response.status === 403) {
            outputChannel?.appendLine(`❌ Access denied (${response.status})`);
            outputChannel?.appendLine('💡 Check if your account has permissions to access this artifact');
        } else {
            outputChannel?.appendLine(`❌ Maven download failed with status ${response.status}`);
        }
    } catch (error: any) {
        outputChannel?.appendLine(`❌ Maven download error: ${error.message || error}`);

        if (axios.isAxiosError(error)) {
            if (error.response?.status === 404) {
                outputChannel?.appendLine('💡 Artifact not found in Maven - likely manually deployed');
            } else if (error.response?.status === 401 || error.response?.status === 403) {
                outputChannel?.appendLine('💡 Access denied - check account permissions');
            }
        }
    }

    return undefined;
}

async function enrichDeploymentDetails(
    context: vscode.ExtensionContext,
    orgId: string,
    environmentId: string,
    deploymentId: string,
    current: any,
    outputChannel?: vscode.OutputChannel
): Promise<any> {
    if (hasArtifactHints(current)) {
        outputChannel?.appendLine('✅ Current deployment already has artifact hints, skipping enrichment');
        return current;
    }

    outputChannel?.appendLine('🔍 No artifact hints found, trying to enrich deployment details...');
    outputChannel?.appendLine(`Org ID: ${orgId}`);
    outputChannel?.appendLine(`Environment ID: ${environmentId}`);
    outputChannel?.appendLine(`Deployment ID: ${deploymentId}`);
    
    const graphqlDetails = await fetchDeploymentDetailsGraphQL(context, orgId, environmentId, deploymentId, outputChannel);
    if (graphqlDetails && hasArtifactHints(graphqlDetails)) {
        outputChannel?.appendLine('✅ Found artifact details via GraphQL API');
        return {
            ...current,
            ...graphqlDetails,
            organizationId: orgId,
        };
    } else if (graphqlDetails) {
        outputChannel?.appendLine('⚠️ GraphQL returned deployment data but no artifact hints detected');
        outputChannel?.appendLine('GraphQL data:');
        outputChannel?.appendLine(JSON.stringify(graphqlDetails, null, 2));
    } else {
        outputChannel?.appendLine('❌ GraphQL API returned no deployment data');
    }

    // Fallback to REST API
    outputChannel?.appendLine('\n--- REST API Enrichment (Fallback) ---');
    outputChannel?.appendLine('🔍 GraphQL did not provide artifact details, trying REST API...');
    console.log('GraphQL API did not provide artifact details, trying REST API');

    const details = await fetchDeploymentDetails(context, orgId, environmentId, deploymentId, outputChannel);
    if (!details) {
        outputChannel?.appendLine('❌ REST API enrichment failed - no data returned');
        return current;
    }

    outputChannel?.appendLine('✅ REST API returned deployment details');
    outputChannel?.appendLine('📊 REST API response data:');
    outputChannel?.appendLine(JSON.stringify(details, null, 2));

    // Check if REST API has artifact reference
    if (details?.application?.ref) {
        outputChannel?.appendLine('🎯 Found artifact reference in REST API response!');
        outputChannel?.appendLine(`   groupId: ${details.application.ref.groupId}`);
        outputChannel?.appendLine(`   artifactId: ${details.application.ref.artifactId}`);
        outputChannel?.appendLine(`   version: ${details.application.ref.version}`);
        outputChannel?.appendLine(`   packaging: ${details.application.ref.packaging}`);
    } else {
        outputChannel?.appendLine('⚠️  No artifact reference found in REST API response');
    }

    // Also try to get application-specific details that might have more artifact info
    const appDetails = await fetchApplicationDetails(context, orgId, environmentId, details, current);

    const merged = {
        ...current,
        ...details,
        ...appDetails,
        // Ensure organization ID is available for artifact coordinate inference
        organizationId: current?.organizationId || details?.organizationId || appDetails?.organizationId || orgId,
        application: {
            ...(current?.application ?? {}),
            ...(details?.application ?? {}),
            ...(appDetails?.application ?? {}),
        },
        artifact: {
            ...(current?.artifact ?? {}),
            ...(details?.artifact ?? {}),
            ...(appDetails?.artifact ?? {}),
        },
    };

    outputChannel?.appendLine('\n--- Merged Deployment Data ---');
    outputChannel?.appendLine('📦 Final merged deployment data:');
    outputChannel?.appendLine(JSON.stringify(merged, null, 2));

    return merged;
}

function hasArtifactHints(deployment: any): boolean {
    if (!deployment) {
        return false;
    }

    const artifact = deployment.artifact || deployment?.application?.artifact;
    if (!artifact) {
        return Boolean(
            deployment?.artifactUri
            || deployment?.artifactUrl
            || deployment?.downloadUrl
        );
    }

    return Boolean(
        artifact?.downloadUrl
        || artifact?.downloadURL
        || artifact?.uri
        || artifact?.url
        || artifact?.location
        || (Array.isArray(artifact?.links) && artifact.links.some((link: any) => link?.href))
    );
}

async function fetchDeploymentDetailsGraphQL(
    context: vscode.ExtensionContext,
    orgId: string,
    environmentId: string,
    deploymentId: string,
    outputChannel?: vscode.OutputChannel
): Promise<any | undefined> {
    const graphqlEndpoint = `${BASE_URL}/graph/api/v2/graphql`;
    
    outputChannel?.appendLine('\n--- GraphQL Deployment Details Query ---');
    outputChannel?.appendLine(`📡 Endpoint: ${graphqlEndpoint}`);
    
    let accessToken = await context.secrets.get('anypoint.accessToken');
    if (!accessToken) {
        outputChannel?.appendLine('❌ No access token for deployment details GraphQL request');
        return undefined;
    }
    
    outputChannel?.appendLine('✅ Access token retrieved for deployment details');

    // GraphQL query to get deployment details with artifact information
    // Using a more flexible query that should capture all available fields
    const query = `
        query GetDeploymentDetails($orgId: String!, $envId: String!, $deploymentId: String!) {
            deployment(organizationId: $orgId, environmentId: $envId, deploymentId: $deploymentId) {
                id
                name
                status
                organizationId
                environmentId
                applicationId
                applicationName
                version
                
                application {
                    id
                    name
                    version
                    groupId
                    assetId
                    artifactName
                    
                    artifact {
                        groupId
                        assetId
                        version
                        classifier
                        packaging
                        uri
                        url
                        downloadUrl
                        downloadURL
                        location
                        name
                        fileName
                    }
                }
                
                target {
                    application {
                        groupId
                        assetId
                        version
                        artifact {
                            groupId
                            assetId
                            version
                            classifier
                            packaging
                            uri
                            url
                            downloadUrl
                        }
                    }
                    
                    artifact {
                        groupId
                        assetId
                        version
                        classifier
                        packaging
                        uri
                        url
                        downloadUrl
                    }
                }
                
                appliedConfiguration {
                    application {
                        groupId
                        assetId
                        version
                        artifact {
                            groupId
                            assetId
                            version
                            classifier
                            packaging
                            uri
                            downloadUrl
                        }
                    }
                    
                    artifact {
                        groupId
                        assetId
                        version
                        classifier
                        packaging
                        uri
                        downloadUrl
                    }
                }
                
                desiredState {
                    application {
                        groupId
                        assetId
                        version
                        artifact {
                            groupId
                            assetId
                            version
                            uri
                        }
                    }
                }
                
                currentState {
                    application {
                        groupId
                        assetId
                        version
                        artifact {
                            groupId
                            assetId
                            version
                            uri
                        }
                    }
                }
            }
        }
    `;

    const variables = {
        orgId,
        envId: environmentId,
        deploymentId
    };

    const issueRequest = async (token: string) => {
        return axios.post(graphqlEndpoint, {
            query,
            variables
        }, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-ANYPNT-ORG-ID': orgId,
                'X-ANYPNT-ENV-ID': environmentId,
            },
            validateStatus: () => true,
        });
    };

    try {
        let response = await issueRequest(accessToken);
        
        if (response.status === 401) {
            console.warn('GraphQL deployment request returned 401. Attempting to refresh access token.');
            const refreshed = await refreshAccessToken(context);
            if (!refreshed) {
                console.warn('Failed to refresh access token for GraphQL request.');
                return undefined;
            }

            accessToken = await context.secrets.get('anypoint.accessToken');
            if (!accessToken) {
                console.warn('No access token available after refresh for GraphQL request.');
                return undefined;
            }

            response = await issueRequest(accessToken);
        }

        if (response.status >= 400) {
            console.warn(`GraphQL deployment details request failed with status ${response.status}`);
            console.warn('Response:', response.data);
            return undefined;
        }

        if (response.data?.errors) {
            console.warn('GraphQL errors:', response.data.errors);
            
            // If we get field errors, try a simpler query
            const hasFieldErrors = response.data.errors.some((error: any) => 
                error.message && error.message.includes('field') || error.message.includes('Field')
            );
            
            if (hasFieldErrors) {
                outputChannel?.appendLine('🔄 Field errors detected, trying simplified query...');
                return await fetchDeploymentDetailsGraphQLSimple(context, orgId, environmentId, deploymentId, outputChannel);
            }
            
            return undefined;
        }

        console.log('🔍 DEPLOYMENT GRAPHQL RESPONSE:', JSON.stringify(response.data, null, 2));
        outputChannel?.appendLine(`📨 GraphQL Response Status: ${response.status}`);
        outputChannel?.appendLine(`📋 GraphQL Response Headers: ${JSON.stringify(response.headers, null, 2)}`);
        outputChannel?.appendLine(`📄 GraphQL Full Response: ${JSON.stringify(response.data, null, 2)}`);
        
        const deployment = response.data?.data?.deployment;
        if (deployment) {
            outputChannel?.appendLine('✅ Successfully fetched deployment details via GraphQL');
            outputChannel?.appendLine(`📊 GraphQL deployment data: ${JSON.stringify(deployment, null, 2)}`);
            return deployment;
        }

        // Check for GraphQL errors
        if (response.data?.errors) {
            outputChannel?.appendLine(`❌ GraphQL returned errors: ${JSON.stringify(response.data.errors, null, 2)}`);
        }
        
        outputChannel?.appendLine('❌ No deployment data returned from GraphQL query');
        return undefined;
    } catch (error: unknown) {
        console.warn('GraphQL deployment details request failed:', error);
        return undefined;
    }
}

async function fetchDeploymentDetailsGraphQLSimple(
    context: vscode.ExtensionContext,
    orgId: string,
    environmentId: string,
    deploymentId: string,
    outputChannel?: vscode.OutputChannel
): Promise<any | undefined> {
    const graphqlEndpoint = `${BASE_URL}/graph/api/v2/graphql`;
    
    outputChannel?.appendLine('\n--- Simplified GraphQL Deployment Query ---');
    outputChannel?.appendLine(`📡 Endpoint: ${graphqlEndpoint}`);
    
    let accessToken = await context.secrets.get('anypoint.accessToken');
    if (!accessToken) {
        outputChannel?.appendLine('❌ No access token for simplified GraphQL request');
        return undefined;
    }
    
    outputChannel?.appendLine('✅ Access token retrieved for simplified query');

    // Simplified GraphQL query with minimal fields that should exist
    const query = `
        query GetDeploymentDetailsSimple($orgId: String!, $envId: String!, $deploymentId: String!) {
            deployment(organizationId: $orgId, environmentId: $envId, deploymentId: $deploymentId) {
                id
                name
                status
                organizationId
                environmentId
                applicationId
                applicationName
                version
            }
        }
    `;

    const variables = {
        orgId,
        envId: environmentId,
        deploymentId
    };

    const issueRequest = async (token: string) => {
        return axios.post(graphqlEndpoint, {
            query,
            variables
        }, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-ANYPNT-ORG-ID': orgId,
                'X-ANYPNT-ENV-ID': environmentId,
            },
            validateStatus: () => true,
        });
    };

    try {
        let response = await issueRequest(accessToken);
        
        if (response.status === 401) {
            const refreshed = await refreshAccessToken(context);
            if (!refreshed) {
                return undefined;
            }

            accessToken = await context.secrets.get('anypoint.accessToken');
            if (!accessToken) {
                return undefined;
            }

            response = await issueRequest(accessToken);
        }

        if (response.status >= 400) {
            console.warn(`Simplified GraphQL deployment details request failed with status ${response.status}`);
            console.warn('Response:', response.data);
            return undefined;
        }

        console.log('🔍 SIMPLIFIED DEPLOYMENT GRAPHQL RESPONSE:', JSON.stringify(response.data, null, 2));
        outputChannel?.appendLine(`📨 Simplified GraphQL Response Status: ${response.status}`);
        outputChannel?.appendLine(`📄 Simplified GraphQL Full Response: ${JSON.stringify(response.data, null, 2)}`);
        
        if (response.data?.errors) {
            outputChannel?.appendLine(`❌ Simplified GraphQL returned errors: ${JSON.stringify(response.data.errors, null, 2)}`);
            return undefined;
        }

        const deployment = response.data?.data?.deployment;
        if (deployment) {
            outputChannel?.appendLine('✅ Successfully fetched basic deployment details via simplified GraphQL');
            outputChannel?.appendLine('📊 Simplified GraphQL deployment data:');
            outputChannel?.appendLine(JSON.stringify(deployment, null, 2));
            
            // For simplified query, we'll use inference based on application name and org
            if (deployment.applicationName && deployment.version) {
                deployment.inferredArtifact = {
                    groupId: orgId,
                    assetId: deployment.applicationName,
                    version: deployment.version,
                    packaging: 'mule-application'
                };
                outputChannel?.appendLine('✅ Added inferred artifact coordinates:');
                outputChannel?.appendLine(JSON.stringify(deployment.inferredArtifact, null, 2));
            } else {
                outputChannel?.appendLine('⚠️ Cannot infer artifact coordinates - missing applicationName or version');
            }
            
            return deployment;
        }

        outputChannel?.appendLine('❌ No deployment data returned from simplified GraphQL query');
        return undefined;
    } catch (error: unknown) {
        console.warn('Simplified GraphQL deployment details request failed:', error);
        return undefined;
    }
}

async function fetchDeploymentDetails(
    context: vscode.ExtensionContext,
    orgId: string,
    environmentId: string,
    deploymentId: string,
    outputChannel?: vscode.OutputChannel
): Promise<any | undefined> {
    const baseUrl = `${BASE_URL}/amc/application-manager/api/v2/organizations/${orgId}/environments/${environmentId}/deployments/${deploymentId}`;

    outputChannel?.appendLine(`📡 Calling REST API: ${baseUrl}`);

    let accessToken = await context.secrets.get('anypoint.accessToken');
    if (!accessToken) {
        outputChannel?.appendLine('❌ No access token available for REST API call');
        return undefined;
    }

    const issueRequest = async (token: string) => {
        return axios.get(baseUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'X-ANYPNT-ORG-ID': orgId,
                'X-ANYPNT-ENV-ID': environmentId,
            },
            validateStatus: () => true,
        });
    };

    try {
        outputChannel?.appendLine('📤 Sending REST API request...');
        let response = await issueRequest(accessToken);
        outputChannel?.appendLine(`📨 REST API Response Status: ${response.status}`);

        if (response.status === 401) {
            outputChannel?.appendLine('🔒 Unauthorized (401) - attempting token refresh...');
            throw createUnauthorizedError(baseUrl);
        }
        if (response.status >= 400) {
            outputChannel?.appendLine(`❌ REST API request failed with status ${response.status}`);
            console.warn(`Deployment details lookup failed with status ${response.status}`);
            return undefined;
        }

        outputChannel?.appendLine('✅ REST API request successful');
        return response.data;
    } catch (error: unknown) {
        if (!isUnauthorized(error)) {
            console.warn('Failed to read deployment details for artifact lookup.', error);
            return undefined;
        }

        const refreshed = await refreshAccessToken(context);
        if (!refreshed) {
            return undefined;
        }

        accessToken = await context.secrets.get('anypoint.accessToken');
        if (!accessToken) {
            return undefined;
        }

        try {
            const retry = await issueRequest(accessToken);
            if (retry.status === 401) {
                return undefined;
            }
            if (retry.status >= 400) {
                console.warn(`Deployment details retry failed with status ${retry.status}`);
                return undefined;
            }
            return retry.data;
        } catch (retryError: unknown) {
            console.warn('Retry fetchDeploymentDetails failed.', retryError);
            return undefined;
        }
    }
}

async function fetchApplicationDetails(
    context: vscode.ExtensionContext,
    orgId: string,
    environmentId: string,
    deploymentDetails: any,
    currentDeployment: any
): Promise<any | undefined> {
    // Try to get application ID from various sources
    const applicationId = deploymentDetails?.applicationId 
        || deploymentDetails?.application?.id
        || deploymentDetails?.application?.applicationId
        || currentDeployment?.applicationId
        || currentDeployment?.application?.id;
    
    if (!applicationId) {
        console.log('No application ID found for additional details lookup');
        return undefined;
    }

    const baseUrl = `${BASE_URL}/amc/application-manager/api/v2/organizations/${orgId}/environments/${environmentId}/applications/${applicationId}`;

    let accessToken = await context.secrets.get('anypoint.accessToken');
    if (!accessToken) {
        return undefined;
    }

    const issueRequest = async (token: string) => {
        return axios.get(baseUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'X-ANYPNT-ORG-ID': orgId,
                'X-ANYPNT-ENV-ID': environmentId,
            },
            validateStatus: () => true,
        });
    };

    try {
        let response = await issueRequest(accessToken);
        if (response.status === 401) {
            const refreshed = await refreshAccessToken(context);
            if (!refreshed) {
                return undefined;
            }

            accessToken = await context.secrets.get('anypoint.accessToken');
            if (!accessToken) {
                return undefined;
            }

            response = await issueRequest(accessToken);
        }
        
        if (response.status >= 400) {
            console.warn(`Application details lookup failed with status ${response.status}`);
            return undefined;
        }
        
        console.log('Fetched additional application details for artifact extraction');
        return response.data;
    } catch (error: unknown) {
        console.warn('Failed to read application details for artifact lookup.', error);
        return undefined;
    }
}

function renderDiagramWebview(
    context: vscode.ExtensionContext,
    appLabel: string,
    graph: MuleFlowGraph,
    mermaid: string,
    metadata: { artifactName?: string; fileCount: number }
): void {
    const panel = vscode.window.createWebviewPanel(
        'anypointApplicationDiagram',
        `Application Diagram — ${appLabel}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true }
    );

    const nonce = createNonce();
    const toolkitUri = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    const sanitizedMermaid = mermaid.replace(/`/g, '\\`');
    const cspSource = panel.webview.cspSource;

    panel.webview.html = /* html */ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} https: data:; font-src ${cspSource} https: data:; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${escapeHtml(appLabel)} — Mule Flow Diagram</title>
            <style>
                body {
                    font-family: "Segoe UI", sans-serif;
                    margin: 0;
                    background: #0d1117;
                    color: #c9d1d9;
                }

                header {
                    padding: 16px 24px;
                    border-bottom: 1px solid #21262d;
                }

                .meta {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 12px;
                    margin-top: 8px;
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }

                #diagram {
                    padding: 16px;
                    overflow: auto;
                    height: calc(100vh - 120px);
                    animation: fadeIn 1s ease-out 0.4s both;
                }

                /* Enhanced animations and emotional design */
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                @keyframes pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                }
                
                @keyframes glow {
                    0%, 100% { box-shadow: 0 0 5px rgba(102, 126, 234, 0.3); }
                    50% { box-shadow: 0 0 20px rgba(102, 126, 234, 0.6), 0 0 30px rgba(102, 126, 234, 0.4); }
                }
                
                /* Enhanced Mermaid styling with animations */
                #diagram svg {
                    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
                    transition: transform 0.3s ease;
                }
                
                #diagram svg:hover {
                    transform: scale(1.02);
                }
                
                /* Animated nodes */
                .node rect, .node circle, .node ellipse, .node polygon {
                    transition: all 0.3s ease;
                    cursor: pointer;
                }
                
                .node:hover rect, .node:hover circle, .node:hover ellipse, .node:hover polygon {
                    animation: pulse 1.5s infinite;
                    filter: brightness(1.2);
                }
                
                /* Animated edges */
                .edgePath path {
                    transition: stroke-width 0.3s ease, stroke 0.3s ease;
                }
                
                .edgePath:hover path {
                    stroke-width: 3px;
                    filter: drop-shadow(0 0 5px currentColor);
                }

                pre {
                    display: none;
                }

                .stats {
                    font-size: 13px;
                    display: flex;
                    gap: 16px;
                }

                .list {
                    padding: 16px 24px;
                    border-top: 1px solid #21262d;
                    background: #0b0d12;
                    font-size: 13px;
                }

                .list ul {
                    margin: 8px 0 0;
                    padding-left: 20px;
                    columns: 2;
                    column-gap: 32px;
                }

                .controls {
                    margin-top: 12px;
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                    align-items: center;
                }

                .export-controls {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }

                .zoom-controls {
                    display: flex;
                    gap: 4px;
                    align-items: center;
                    margin-right: 16px;
                }

                .export-btn, .zoom-btn {
                    background: #238636;
                    color: white;
                    border: 1px solid #2ea043;
                    border-radius: 6px;
                    padding: 6px 12px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                    min-width: 32px;
                }

                .zoom-btn {
                    background: #1f6feb;
                    border: 1px solid #388bfd;
                    padding: 4px 8px;
                    font-weight: bold;
                }

                .export-btn:hover, .zoom-btn:hover {
                    background: #2ea043;
                }

                .zoom-btn:hover {
                    background: #388bfd;
                }

                .export-btn:active, .zoom-btn:active {
                    background: #1a7f37;
                }

                .zoom-btn:active {
                    background: #1f6feb;
                }

                .zoom-level {
                    color: #7d8590;
                    font-size: 11px;
                    margin: 0 4px;
                    min-width: 30px;
                    text-align: center;
                }

                #diagram {
                    position: relative;
                    overflow: auto;
                }

                #diagram svg {
                    background: white;
                    border-radius: 6px;
                    padding: 16px;
                    transition: transform 0.2s ease;
                    transform-origin: top left;
                }
            </style>
        </head>
        <body>
            <header>
                <h2>${escapeHtml(appLabel)}</h2>
                <div class="meta">
                    <span>${graph.nodes.length} flows</span>
                    <span>${graph.edges.length} connections</span>
                    <span>${metadata.fileCount} XML files</span>
                    ${metadata.artifactName ? `<span>Artifact: ${escapeHtml(metadata.artifactName)}</span>` : ''}
                </div>
                <div class="controls">
                    <div class="zoom-controls">
                        <button id="zoom-out" class="zoom-btn">−</button>
                        <span id="zoom-level" class="zoom-level">100%</span>
                        <button id="zoom-in" class="zoom-btn">+</button>
                        <button id="zoom-reset" class="zoom-btn">Reset</button>
                    </div>
                    <div class="export-controls">
                        <button id="copy-mermaid" class="export-btn">📋 Copy Mermaid Code</button>
                    </div>
                </div>
            </header>
            <section id="diagram"></section>
            <pre id="mermaid-source">${sanitizedMermaid}</pre>
            <section class="list">
                <strong>Flows by file</strong>
                <ul>
                    ${renderFlowsByFile(graph.nodes)}
                </ul>
            </section>
            <script type="module" nonce="${nonce}">
                import mermaid from '${toolkitUri}';
                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: 'loose',
                    theme: 'dark'
                });

                const source = document.getElementById('mermaid-source');
                const target = document.getElementById('diagram');

                mermaid.render('mule-diagram', source.textContent ?? '')
                    .then(result => {
                        target.innerHTML = result.svg;
                        setupExportHandlers();
                        setupZoomHandlers();
                    })
                    .catch(err => {
                        const message = err && typeof err === 'object' && 'message' in err ? err.message : String(err);
                        target.innerHTML = '<pre style="color:#ff6b6b;">Mermaid rendering failed: ' + message + '</pre>';
                    });

                function setupExportHandlers() {
                    // Copy Mermaid code
                    document.getElementById('copy-mermaid').addEventListener('click', () => {
                        const mermaidSource = document.getElementById('mermaid-source');
                        if (mermaidSource) {
                            navigator.clipboard.writeText(mermaidSource.textContent || '').then(() => {
                                const btn = document.getElementById('copy-mermaid');
                                const originalText = btn.textContent;
                                btn.textContent = '✅ Copied!';
                                setTimeout(() => {
                                    btn.textContent = originalText;
                                }, 2000);
                            });
                        }
                    });
                }


                function setupZoomHandlers() {
                    const svgElement = document.querySelector('#diagram svg');
                    const zoomLevelElement = document.getElementById('zoom-level');
                    let currentZoom = 1.0;
                    const zoomStep = 0.2;
                    const minZoom = 0.2;
                    const maxZoom = 3.0;

                    function updateZoom(newZoom) {
                        currentZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));
                        if (svgElement) {
                            svgElement.style.transform = 'scale(' + currentZoom + ')';
                        }
                        if (zoomLevelElement) {
                            zoomLevelElement.textContent = Math.round(currentZoom * 100) + '%';
                        }
                    }

                    document.getElementById('zoom-in').addEventListener('click', () => {
                        updateZoom(currentZoom + zoomStep);
                    });

                    document.getElementById('zoom-out').addEventListener('click', () => {
                        updateZoom(currentZoom - zoomStep);
                    });

                    document.getElementById('zoom-reset').addEventListener('click', () => {
                        updateZoom(1.0);
                    });

                    // Mouse wheel zoom
                    document.getElementById('diagram').addEventListener('wheel', (e) => {
                        if (e.ctrlKey || e.metaKey) {
                            e.preventDefault();
                            const delta = e.deltaY > 0 ? -zoomStep : zoomStep;
                            updateZoom(currentZoom + delta);
                        }
                    });
                }

            </script>
        </body>
        </html>
    `;
}

function renderFlowsByFile(nodes: MuleFlowNode[]): string {
    const grouped = new Map<string, MuleFlowNode[]>();

    nodes.forEach(node => {
        const key = node.filePath === 'unknown' ? 'unknown' : node.filePath;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key)!.push(node);
    });

    return Array.from(grouped.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([filePath, flows]) => {
        const label = filePath === 'unknown' ? 'Unknown Source' : filePath;
        const flowNames = flows
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(flow => escapeHtml(flow.name))
            .join(', ');
        return `<li><strong>${escapeHtml(label)}</strong>: ${flowNames}</li>`;
    }).join('');
}

function createNonce(): string {
    return Math.random().toString(36).slice(2, 12);
}

function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isUnauthorized(error: unknown): boolean {
    if (!error) {
        return false;
    }

    if (axios.isAxiosError(error)) {
        return error.response?.status === 401;
    }

    const axiosError = error as AxiosError;
    return axiosError.response?.status === 401;
}

function createUnauthorizedError(url: string): AxiosError {
    return new AxiosError(`Unauthorized while downloading artifact from ${url}`, '401');
}

function buildArtifactUrlCandidates(
    orgId: string,
    environmentId: string,
    deploymentId: string,
    deployment: any,
    outputChannel?: vscode.OutputChannel
): string[] {
    const urls = new Set<string>();

    const add = (value?: string | null) => {
        if (!value) {
            return;
        }
        urls.add(value);
    };

    // CloudHub 2.0 specific endpoints (these are the most likely to work)
    const ch2Base = `${BASE_URL}/amc/application-manager/api/v2/organizations/${orgId}/environments/${environmentId}`;
    
    // Try deployment-specific artifact endpoints first
    add(`${ch2Base}/deployments/${deploymentId}/artifact`);
    add(`${ch2Base}/deployments/${deploymentId}/artifact/download`);
    
    // Try with explicit download parameter
    add(`${ch2Base}/deployments/${deploymentId}/artifact?download=true`);
    
    // Alternative CloudHub 2.0 API bases
    const ch2AltBases = [
        `${BASE_URL}/amc/application-manager/api/v1/organizations/${orgId}/environments/${environmentId}`,
        `${BASE_URL}/amc/application-manager/organizations/${orgId}/environments/${environmentId}`,
        `${BASE_URL}/cloudhub-2/api/v1/organizations/${orgId}/environments/${environmentId}`,
        `${BASE_URL}/cloudhub-2/organizations/${orgId}/environments/${environmentId}`,
    ];
    
    ch2AltBases.forEach(altBase => {
        add(`${altBase}/deployments/${deploymentId}/artifact`);
        add(`${altBase}/deployments/${deploymentId}/artifact/download`);
    });
    
    // CloudHub 1.0 style endpoints (for backward compatibility)
    const cloudhubOrgBase = `${BASE_URL}/cloudhub/api/v2/organizations/${orgId}/environments/${environmentId}`;
    add(`${cloudhubOrgBase}/deployments/${deploymentId}/artifact`);
    add(`${cloudhubOrgBase}/deployments/${deploymentId}/artifact/download`);

    const applicationId = deployment?.applicationId
        || deployment?.application?.id
        || deployment?.application?.applicationId
        || deployment?.application?.internalId
        || deployment?.application?.applicationRef;

    if (applicationId) {
        add(`${ch2Base}/applications/${applicationId}/deployments/${deploymentId}/artifact`);
        add(`${ch2Base}/applications/${applicationId}/deployments/${deploymentId}/artifact/download`);
        add(`${ch2Base}/applications/${applicationId}/artifact`);
        add(`${ch2Base}/applications/${applicationId}/artifact/download`);
        add(`${ch2Base}/applications/${applicationId}/artifact?download=true`);
        add(`${ch2Base}/applications/${applicationId}/artifact?environmentId=${environmentId}&organizationId=${orgId}`);

        const cloudhubOrgBaseApps = `${BASE_URL}/cloudhub/api/v2/organizations/${orgId}/environments/${environmentId}`;
        add(`${cloudhubOrgBaseApps}/applications/${applicationId}/artifact`);
        add(`${cloudhubOrgBaseApps}/applications/${applicationId}/artifact/download`);
        add(`${cloudhubOrgBaseApps}/applications/${applicationId}/deployments/${deploymentId}/artifact`);

        const runtimeFabricOrgBase = `${BASE_URL}/runtimefabric/api/v1/organizations/${orgId}/environments/${environmentId}`;
        add(`${runtimeFabricOrgBase}/applications/${applicationId}/artifact`);
        add(`${runtimeFabricOrgBase}/applications/${applicationId}/artifact/download`);
    }

    const applicationName = deployment?.application?.name
        || deployment?.applicationName
        || deployment?.name;

    if (applicationName) {
        const encodedName = encodeURIComponent(applicationName);
        const cloudhubBase = `${BASE_URL}/cloudhub/api/v2`;
        add(`${cloudhubBase}/applications/${encodedName}/deployments/${deploymentId}/artifact`);
        add(`${cloudhubBase}/applications/${encodedName}/deployments/${deploymentId}/artifact/download`);
        add(`${cloudhubBase}/applications/${encodedName}/deployments/${deploymentId}/artifact?environmentId=${environmentId}&organizationId=${orgId}`);
        add(`${cloudhubBase}/applications/${encodedName}/artifact`);
        add(`${cloudhubBase}/applications/${encodedName}/artifact/download`);
        add(`${cloudhubBase}/applications/${encodedName}/artifact?environmentId=${environmentId}&organizationId=${orgId}`);
        add(`${cloudhubBase}/organizations/${orgId}/environments/${environmentId}/applications/${encodedName}/artifact`);
        add(`${cloudhubBase}/organizations/${orgId}/environments/${environmentId}/applications/${encodedName}/artifact/download`);

        const runtimeFabricBase = `${BASE_URL}/runtimefabric/api/v1`;
        add(`${runtimeFabricBase}/applications/${encodedName}/artifact`);
        add(`${runtimeFabricBase}/applications/${encodedName}/artifact/download`);
        add(`${runtimeFabricBase}/organizations/${orgId}/environments/${environmentId}/applications/${encodedName}/artifact`);
        add(`${runtimeFabricBase}/organizations/${orgId}/environments/${environmentId}/applications/${encodedName}/artifact/download`);
    }

    const artifact = deployment?.artifact || deployment?.application?.artifact;
    if (artifact) {
        add(artifact.downloadUrl ?? artifact.downloadURL);
        add(artifact.uri ?? artifact.url);
        add(artifact.location);

        if (Array.isArray(artifact.links)) {
            artifact.links.forEach((link: any) => {
                if (link?.href && typeof link.href === 'string') {
                    add(link.href);
                }
            });
        }
    }

    if (Array.isArray(deployment?.links)) {
        deployment.links.forEach((link: any) => {
            if (link?.href && typeof link.href === 'string') {
                add(link.href);
            }
        });
    }

    add(deployment?.artifactUri);
    add(deployment?.artifactUrl);
    add(deployment?.downloadUrl);

    if (Array.isArray(deployment?.artifacts)) {
        deployment.artifacts.forEach((entry: any) => {
            add(entry?.downloadUrl ?? entry?.uri ?? entry?.url);
            if (Array.isArray(entry?.links)) {
                entry.links.forEach((link: any) => add(link?.href));
            }
        });
    }

    // CloudHub 2.0 specific: Try version-based endpoints
    const deploymentVersion = deployment?.desiredVersion 
        || deployment?.lastSuccessfulVersion 
        || deployment?.currentDeploymentVersion;
    
    if (deploymentVersion) {
        outputChannel?.appendLine(`🔍 Found deployment version: ${deploymentVersion}`);
        
        // Version-specific artifact endpoints
        add(`${ch2Base}/deployments/${deploymentId}/versions/${deploymentVersion}/artifact`);
        add(`${ch2Base}/deployments/${deploymentId}/versions/${deploymentVersion}/artifact/download`);
        add(`${cloudhubOrgBase}/deployments/${deploymentId}/versions/${deploymentVersion}/artifact`);
        add(`${cloudhubOrgBase}/deployments/${deploymentId}/versions/${deploymentVersion}/artifact/download`);
        
        // Application version endpoints
        if (applicationId) {
            add(`${ch2Base}/applications/${applicationId}/versions/${deploymentVersion}/artifact`);
            add(`${ch2Base}/applications/${applicationId}/versions/${deploymentVersion}/artifact/download`);
        }
        
        if (applicationName) {
            const encodedName = encodeURIComponent(applicationName);
            const cloudhubRoot = `${BASE_URL}/cloudhub/api/v2`;
            add(`${cloudhubRoot}/applications/${encodedName}/versions/${deploymentVersion}/artifact`);
            add(`${cloudhubRoot}/applications/${encodedName}/versions/${deploymentVersion}/artifact/download`);
        }
    }

    // Exchange API endpoints that may return S3 presigned URLs
    outputChannel?.appendLine(`🔗 Adding Exchange API endpoints for S3 presigned URLs...`);

    // Extract artifact coordinates for Exchange endpoints
    const coords = extractArtifactCoordinates(deployment, outputChannel);
    if (coords) {
        const { groupId, assetId, version } = coords;

        // PRIORITY: Maven Facade API endpoints (CloudHub 2.0 direct download)
        outputChannel?.appendLine(`🔗 Adding Maven Facade API endpoint (CloudHub 2.0)...`);
        const mavenUrl = buildMavenDownloadUrl(orgId, groupId, assetId, version);
        add(mavenUrl);
        outputChannel?.appendLine(`   Maven URL: ${mavenUrl}`);

        // Exchange artifact download endpoints
        add(`${BASE_URL}/exchange/api/v2/organizations/${orgId}/assets/${groupId}/${assetId}/${version}/artifact/download`);
        add(`${BASE_URL}/exchange/api/v2/organizations/${orgId}/assets/${groupId}/${assetId}/${version}/artifact`);
        add(`${BASE_URL}/exchange/api/v2/assets/${groupId}/${assetId}/${version}/artifact/download`);
        add(`${BASE_URL}/exchange/api/v2/assets/${groupId}/${assetId}/${version}/artifact`);
        
        // Exchange file endpoints
        add(`${BASE_URL}/exchange/api/v2/organizations/${orgId}/assets/${groupId}/${assetId}/${version}/files`);
        add(`${BASE_URL}/exchange/api/v2/assets/${groupId}/${assetId}/${version}/files`);
        
        // Exchange asset manager endpoints (where S3 URLs come from)
        add(`${BASE_URL}/exchange/asset-manager/api/v1/organizations/${orgId}/assets/${groupId}/${assetId}/${version}/artifact/download`);
        add(`${BASE_URL}/exchange/asset-manager/api/v1/assets/${groupId}/${assetId}/${version}/artifact/download`);
        
        // CloudHub artifact resolution endpoints (these may return S3 URLs)
        add(`${BASE_URL}/amc/application-manager/api/v2/organizations/${orgId}/environments/${environmentId}/artifacts/${groupId}/${assetId}/${version}/download`);
        add(`${BASE_URL}/amc/application-manager/api/v1/organizations/${orgId}/environments/${environmentId}/artifacts/${groupId}/${assetId}/${version}/download`);
    }
    
    // Generic Exchange endpoints using deployment metadata
    if (applicationName) {
        const encodedName = encodeURIComponent(applicationName);
        add(`${BASE_URL}/exchange/api/v2/organizations/${orgId}/assets/${orgId}/${encodedName}/1.0.0/artifact/download`);
        add(`${BASE_URL}/exchange/asset-manager/api/v1/organizations/${orgId}/assets/${orgId}/${encodedName}/1.0.0/artifact/download`);
    }

    // Additional endpoints for manually deployed applications
    outputChannel?.appendLine(`🏗️ Adding endpoints for manually deployed applications...`);
    
    // CloudHub artifact storage endpoints (where manually uploaded JARs are stored)
    add(`${ch2Base}/deployments/${deploymentId}/files/artifact`);
    add(`${ch2Base}/deployments/${deploymentId}/files/artifact.jar`);
    add(`${ch2Base}/deployments/${deploymentId}/files/application.jar`);
    add(`${ch2Base}/deployments/${deploymentId}/assets/artifact`);
    add(`${ch2Base}/deployments/${deploymentId}/assets/artifact.jar`);
    
    // CloudHub file storage API endpoints
    const fileStorageBase = `${BASE_URL}/cloudhub/api/v2/organizations/${orgId}/environments/${environmentId}`;
    add(`${fileStorageBase}/deployments/${deploymentId}/files/artifact`);
    add(`${fileStorageBase}/deployments/${deploymentId}/files/artifact.jar`);
    add(`${fileStorageBase}/deployments/${deploymentId}/assets/artifact`);
    
    // Application file endpoints with applicationId
    if (applicationId) {
        add(`${ch2Base}/applications/${applicationId}/files/artifact`);
        add(`${ch2Base}/applications/${applicationId}/files/artifact.jar`);
        add(`${ch2Base}/applications/${applicationId}/files/application.jar`);
        add(`${ch2Base}/applications/${applicationId}/assets/artifact`);
        add(`${ch2Base}/applications/${applicationId}/assets/application.jar`);
        
        // Storage service endpoints
        add(`${BASE_URL}/amc/storage/api/v1/organizations/${orgId}/environments/${environmentId}/applications/${applicationId}/artifact`);
        add(`${BASE_URL}/amc/storage/api/v1/organizations/${orgId}/environments/${environmentId}/applications/${applicationId}/files/artifact.jar`);
    }
    
    // Application file endpoints with applicationName
    if (applicationName) {
        const encodedName = encodeURIComponent(applicationName);
        add(`${fileStorageBase}/applications/${encodedName}/files/artifact`);
        add(`${fileStorageBase}/applications/${encodedName}/files/artifact.jar`);
        add(`${fileStorageBase}/applications/${encodedName}/assets/artifact`);
        
        // Storage service with app name
        add(`${BASE_URL}/amc/storage/api/v1/organizations/${orgId}/environments/${environmentId}/applications/${encodedName}/artifact`);
        add(`${BASE_URL}/amc/storage/api/v1/organizations/${orgId}/environments/${environmentId}/applications/${encodedName}/files/artifact.jar`);
    }
    
    // CloudHub internal artifact store (used for manual uploads)
    add(`${BASE_URL}/cloudhub/api/v2/artifacts/${orgId}/${environmentId}/${deploymentId}/artifact`);
    add(`${BASE_URL}/cloudhub/api/v2/artifacts/${orgId}/${environmentId}/${deploymentId}/artifact.jar`);
    
    // MuleSoft internal artifact repository endpoints
    add(`${BASE_URL}/amc/artifact-repository/api/v1/organizations/${orgId}/environments/${environmentId}/deployments/${deploymentId}/artifact`);
    add(`${BASE_URL}/amc/artifact-repository/api/v1/organizations/${orgId}/environments/${environmentId}/deployments/${deploymentId}/files/artifact.jar`);

    // Try replica-specific endpoints
    if (Array.isArray(deployment?.replicas) && deployment.replicas.length > 0) {
        const replica = deployment.replicas[0];
        const replicaVersion = replica?.currentDeploymentVersion;
        
        if (replicaVersion) {
            outputChannel?.appendLine(`🔍 Found replica version: ${replicaVersion}`);
            add(`${ch2Base}/deployments/${deploymentId}/replicas/${replica.id}/artifact`);
            add(`${ch2Base}/deployments/${deploymentId}/versions/${replicaVersion}/artifact`);
        }
    }

    extractCandidateUrlsFromObject(deployment, add);

    // Deduplicate while preserving insertion order for diagnostic output
    return Array.from(urls);
}

function extractCandidateUrlsFromObject(obj: any, add: (value?: string | null) => void, depth = 0): void {
    if (!obj || depth > 6) {
        return;
    }

    if (Array.isArray(obj)) {
        obj.forEach(item => extractCandidateUrlsFromObject(item, add, depth + 1));
        return;
    }

    if (typeof obj !== 'object') {
        return;
    }

    Object.entries(obj).forEach(([key, value]) => {
        if (typeof value === 'string') {
            const lowered = key.toLowerCase();
            if (lowered.includes('artifact') || lowered.includes('download') || lowered.includes('uri') || lowered.includes('url')) {
                if (value.startsWith('http')) {
                    add(value);
                }
            }
        } else if (typeof value === 'object') {
            extractCandidateUrlsFromObject(value, add, depth + 1);
        }
    });
}

function reportDownloadError(error: unknown, attemptedUrls: string[]): void {
    console.error('=== ARTIFACT DOWNLOAD FAILURE DETAILS ===');
    console.error('Attempted URLs:', attemptedUrls);
    console.error('Error details:', error);
    console.error('=========================================');
    
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 404) {
            vscode.window.showErrorMessage(
                `CloudHub 2.0 Application Artifact Not Found\n\n` +
                `This is likely because:\n` +
                `• The application artifact is not accessible via direct download\n` +
                `• The artifact coordinates are missing from deployment metadata\n` +
                `• The application needs to be downloaded from Anypoint Exchange\n\n` +
                `Check the VSCode Developer Console for detailed logs.`,
                'Open Console'
            ).then(selection => {
                if (selection === 'Open Console') {
                    vscode.commands.executeCommand('workbench.action.toggleDevTools');
                }
            });
        } else if (status === 401 || status === 403) {
            vscode.window.showErrorMessage(
                `Access denied while downloading application artifact. Please check your permissions for this application.`
            );
        } else {
            const serverMessage = error.response?.data && typeof error.response.data === 'string'
                ? error.response.data
                : error.message;
            vscode.window.showErrorMessage(
                `Artifact download failed (${status ?? 'unknown status'}): ${serverMessage}. ` +
                `This may be a CloudHub 2.0 application that requires Exchange API access.`
            );
        }
    } else if (error instanceof Error) {
        vscode.window.showErrorMessage(`Artifact download failed: ${error.message}`);
    } else {
        vscode.window.showErrorMessage('Artifact download failed due to an unknown error.');
    }
}

function extractArtifactCoordinates(source: any, outputChannel?: vscode.OutputChannel): ArtifactCoordinates | undefined {
    if (!source || typeof source !== 'object') {
        outputChannel?.appendLine('❌ No source data provided for artifact extraction');
        return undefined;
    }

    outputChannel?.appendLine('🔍 Searching for artifact coordinates in deployment data...');

    // For CloudHub 2.0 applied deployments, check multiple locations
    const candidates = flattenObjects([
        source?.inferredArtifact,           // From simplified GraphQL query
        source?.application?.ref,           // CloudHub 2.0 application reference (MOST COMMON!)
        source?.artifact,
        source?.application?.artifact,
        source?.desiredApplication?.artifact,
        source?.deployment?.artifact,
        source?.application,
        source?.target?.artifact,           // CloudHub 2.0 target state
        source?.target?.application?.artifact, // Nested target application artifact
        source?.target?.application?.ref,   // Target application reference
        source?.spec?.artifact,             // CloudHub 2.0 spec
        source?.status?.artifact,           // CloudHub 2.0 applied status
        source?.appliedConfiguration?.artifact, // CloudHub 2.0 applied config
        source?.appliedConfiguration?.application?.artifact, // Nested applied config artifact
        source?.appliedConfiguration?.application?.ref, // Applied config application ref
        source?.currentConfiguration?.artifact, // CloudHub 2.0 current config
        source?.configuration?.artifact,    // CloudHub 2.0 configuration
        source?.currentState?.application?.artifact, // Current state artifact
        source?.currentState?.application?.ref, // Current state application ref
        source?.desiredState?.application?.artifact, // Desired state artifact
        source?.desiredState?.application?.ref, // Desired state application ref
    ]);

    outputChannel?.appendLine(`📋 Checking ${candidates.length} potential artifact coordinate sources...`);
    
    for (let i = 0; i < candidates.length; i++) {
        const entry = candidates[i];
        if (!entry) {
            outputChannel?.appendLine(`   ${i + 1}. [skipped] - null/undefined`);
            continue;
        }
        
        const groupId = entry?.groupId || entry?.groupID || entry?.group || entry?.organizationId;
        const assetId = entry?.assetId || entry?.artifactId || entry?.name || entry?.artifactName; // CloudHub 2.0 uses artifactId
        const version = entry?.version || entry?.artifactVersion;

        outputChannel?.appendLine(`   ${i + 1}. Checking: groupId=${groupId}, assetId=${assetId}, version=${version}`);
        outputChannel?.appendLine(`       Source: ${JSON.stringify(entry, null, 2)}`);

        if (groupId && assetId && version) {
            const coords = {
                groupId,
                assetId,
                version,
                classifier: entry?.classifier,
                packaging: entry?.packaging || entry?.type || 'mule-application',
            };
            outputChannel?.appendLine(`✅ FOUND COORDINATES at source ${i + 1}:`);
            outputChannel?.appendLine(JSON.stringify(coords, null, 2));
            return coords;
        } else {
            outputChannel?.appendLine(`   ${i + 1}. [incomplete] - missing required fields`);
        }

        if (entry?.uri && typeof entry.uri === 'string') {
            const coords = parseCoordinatesFromUri(entry.uri);
            if (coords) {
                outputChannel?.appendLine(`✅ FOUND COORDINATES from URI at source ${i + 1}:`);
                outputChannel?.appendLine(JSON.stringify(coords, null, 2));
                return coords;
            }
        }
    }

    // Try to extract from top-level properties that might contain Exchange references
    const exchangeUris = [
        source?.artifactUri,
        source?.artifactUrl,
        source?.application?.artifactUri,
        source?.application?.artifactUrl,
        source?.target?.artifactUri,
        source?.spec?.artifactUri,
        source?.status?.artifactUri,           // CloudHub 2.0 applied state
        source?.appliedConfiguration?.artifactUri,
        source?.currentConfiguration?.artifactUri,
        source?.configuration?.artifactUri,
    ].filter(Boolean);

    for (const uri of exchangeUris) {
        const coords = parseCoordinatesFromUri(uri);
        if (coords) {
            console.log('Found artifact coordinates from top-level URI:', coords);
            return coords;
        }
    }

    // CloudHub 2.0 specific: Try to extract from application name and version if it looks like Exchange coordinates
    if (source?.name && source?.version) {
        // Many CloudHub 2.0 apps use the pattern: {groupId}-{assetId} as name
        const appName = source.name;
        const appVersion = source.version;
        
        // Try to infer groupId from the organization if available
        const orgId = source?.organizationId || source?.organization?.id;
        
        if (orgId && appName && appVersion) {
            console.log('Attempting to infer artifact coordinates from app name and version:', { orgId, appName, appVersion });
            return {
                groupId: orgId,
                assetId: appName,
                version: appVersion,
                packaging: 'mule-application',
            };
        }
    }

    console.log('No artifact coordinates found in deployment metadata');
    return undefined;
}

function flattenObjects(objects: any[]): any[] {
    return objects.filter(Boolean);
}

function parseCoordinatesFromUri(uri: string | undefined): ArtifactCoordinates | undefined {
    if (!uri) {
        return undefined;
    }

    console.log('Parsing coordinates from URI:', uri);

    // Supported formats: 
    // exchange://groupId:assetId:version[:classifier]
    // mule-application://groupId:assetId:version[:classifier]
    // exchange:groupId:assetId:version[:classifier] (without //)
    const exchangeMatch = uri.match(/^(?:exchange|mule-application):(?:\/\/)?(.+?):([^:]+):([^:?]+)(?::([^:?]+))?/i);
    if (exchangeMatch) {
        const [, groupId, assetId, version, classifier] = exchangeMatch;
        console.log('Parsed Exchange URI coordinates:', { groupId, assetId, version, classifier });
        return {
            groupId,
            assetId,
            version,
            classifier,
            packaging: 'mule-application',
        };
    }

    // Try to parse HTTP URLs pointing to Exchange assets
    const httpExchangeMatch = uri.match(/\/exchange\/.*\/assets\/([^\/]+)\/([^\/]+)\/([^\/]+)/i);
    if (httpExchangeMatch) {
        const [, groupId, assetId, version] = httpExchangeMatch;
        console.log('Parsed HTTP Exchange URL coordinates:', { groupId, assetId, version });
        return {
            groupId: decodeURIComponent(groupId),
            assetId: decodeURIComponent(assetId),
            version: decodeURIComponent(version),
            packaging: 'mule-application',
        };
    }

    console.log('No coordinates found in URI');
    return undefined;
}

async function downloadArtifactFromExchange(
    coordinates: ArtifactCoordinates,
    orgId: string,
    context: vscode.ExtensionContext,
    outputChannel?: vscode.OutputChannel
): Promise<ArrayBuffer | undefined> {
    const { groupId, assetId, version, classifier, packaging } = coordinates;
    
    // Get access token from active account
    const { AccountService } = await import('../controllers/accountService.js');
    const accountService = new AccountService(context);
    const accessToken = await accountService.getActiveAccountAccessToken();
    if (!accessToken) {
        outputChannel?.appendLine('❌ No access token available for Exchange download');
        return undefined;
    }

    outputChannel?.appendLine(`🔍 Exchange Download Parameters:`);
    outputChannel?.appendLine(`   Group ID: ${groupId}`);
    outputChannel?.appendLine(`   Asset ID: ${assetId}`);
    outputChannel?.appendLine(`   Version: ${version}`);
    outputChannel?.appendLine(`   Classifier: ${classifier || 'none'}`);
    outputChannel?.appendLine(`   Packaging: ${packaging || 'none'}`);

    const encodedGroup = encodeURIComponent(groupId);
    const encodedAsset = encodeURIComponent(assetId);
    const encodedVersion = encodeURIComponent(version);

    // Try different packaging types for Mule applications
    // Note: CloudHub 2.0 often reports 'jar' but Exchange expects 'mule-application'
    const packagingTypes = [
        'mule-application',  // Try this first for Mule apps
        packaging || 'jar',  // Then the reported packaging type
        'jar',
        'mule-application-template',
        'mule-plugin'
    ].filter((type, index, arr) => arr.indexOf(type) === index); // Remove duplicates

    for (const pkgType of packagingTypes) {
        const base = `${BASE_URL}/exchange/api/v1/assets/${encodedGroup}/${encodedAsset}/${encodedVersion}/download`;
        const params = new URLSearchParams();
        
        if (classifier) {
            params.set('classifier', classifier);
        }
        params.set('type', pkgType);

        const url = params.toString() ? `${base}?${params.toString()}` : base;
        
        outputChannel?.appendLine(`🔄 Trying Exchange download with packaging type '${pkgType}':`);
        outputChannel?.appendLine(`   URL: ${url}`);

        try {
            const response = await axios.get<ArrayBuffer>(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/octet-stream, application/java-archive, application/zip',
                    'X-ANYPNT-ORG-ID': orgId,
                },
                responseType: 'arraybuffer',
                validateStatus: status => (status ?? 0) < 500,
            });

            outputChannel?.appendLine(`   📨 Response Status: ${response.status}`);
            
            if (response.status === 404) {
                outputChannel?.appendLine(`   ❌ Exchange artifact not found with packaging type '${pkgType}'`);
                continue;
            }

            if (response.status === 401) {
                outputChannel?.appendLine(`   🔒 Unauthorized access to Exchange artifact`);
                throw new AxiosError(`Unauthorized access to Exchange artifact`, '401', undefined, undefined, response);
            }

            if ((response.status ?? 0) >= 300) {
                outputChannel?.appendLine(`   ❌ Exchange download failed with status ${response.status} for packaging type '${pkgType}'`);
                outputChannel?.appendLine(`   Response: ${JSON.stringify(response.data, null, 2)}`);
                continue;
            }

            outputChannel?.appendLine(`   ✅ Successfully downloaded artifact from Exchange with packaging type '${pkgType}'`);
            outputChannel?.appendLine(`   📦 Downloaded ${response.data.byteLength} bytes`);
            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                throw error; // Re-throw auth errors
            }
            outputChannel?.appendLine(`   ❌ Exception during Exchange download for packaging type '${pkgType}': ${error}`);
            if (error instanceof Error) {
                outputChannel?.appendLine(`   Error: ${error.message}`);
            }
            continue;
        }
    }

    outputChannel?.appendLine('❌ All Exchange download attempts failed');
    return undefined;
}

async function chooseRenderingMode(
    context: vscode.ExtensionContext,
    label: string,
    graph: MuleFlowGraph,
    metadata: { artifactName?: string; fileCount: number },
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const totalNodes = graph.nodes.length;
    const totalComponents = graph.nodes.reduce((sum, node) => sum + countComponents(node.components), 0);
    
    const options: vscode.QuickPickItem[] = [
        {
            label: '🎯 Auto (Recommended)',
            description: 'Automatically choose the best format for diagram size',
            detail: `Will choose detailed view for small diagrams, simplified for large ones (${totalNodes} flows, ${totalComponents} components)`
        },
        {
            label: '📊 Detailed View (Limited Components)',
            description: 'Show up to 10 components per flow with details',
            detail: 'Shows limited components with detailed information - good for medium flows'
        },
        {
            label: '🔍 Full Detailed View (ALL Components)',
            description: 'Show ALL nested components including children',
            detail: 'Shows every single component recursively - best for small flows only'
        },
        {
            label: '🗂️ Simplified View (Flow Overview)',
            description: 'Show only flows with component counts',
            detail: 'Simplified view showing flow relationships - best for large applications'
        },
        {
            label: '🔀 Individual Flow View',
            description: 'Render each flow separately for detailed analysis',
            detail: 'Create separate diagrams for each flow - best for complex applications'
        }
    ];

    const modeChoice = await vscode.window.showQuickPick(options, {
        placeHolder: 'Choose diagram rendering mode',
        matchOnDetail: true,
        ignoreFocusOut: true
    });

    if (!modeChoice) {
        outputChannel.appendLine('❌ No rendering mode selected');
        return;
    }

    outputChannel.appendLine(`✅ Selected mode: ${modeChoice.label}`);

    switch (modeChoice.label) {
        case '🎯 Auto (Recommended)':
            await renderSingleDiagram(context, label, graph, metadata, 'auto', outputChannel);
            break;
        case '📊 Detailed View (Limited Components)':
            await renderSingleDiagram(context, label, graph, metadata, 'detailed', outputChannel);
            break;
        case '🔍 Full Detailed View (ALL Components)':
            await renderSingleDiagram(context, label, graph, metadata, 'full-detailed', outputChannel);
            break;
        case '🗂️ Simplified View (Flow Overview)':
            await renderSingleDiagram(context, label, graph, metadata, 'simplified', outputChannel);
            break;
        case '🔀 Individual Flow View':
            await renderIndividualFlows(context, label, graph, metadata, outputChannel);
            break;
    }
}

async function renderSingleDiagram(
    context: vscode.ExtensionContext,
    label: string,
    graph: MuleFlowGraph,
    metadata: { artifactName?: string; fileCount: number },
    mode: string,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const mermaid = buildMermaidDefinitionWithMode(graph, mode);
    outputChannel.appendLine(`📊 Generated ${mode} Mermaid definition with ${mermaid.split('\n').length} lines`);
    
    const modeLabel = mode === 'auto' ? ' (Auto)' 
        : mode === 'detailed' ? ' (Detailed)' 
        : mode === 'full-detailed' ? ' (Full Detailed)'
        : ' (Simplified)';
    
    renderDiagramWebview(
        context,
        `${label}${modeLabel}`,
        graph,
        mermaid,
        metadata
    );
}

async function renderIndividualFlows(
    context: vscode.ExtensionContext,
    label: string,
    graph: MuleFlowGraph,
    metadata: { artifactName?: string; fileCount: number },
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const flowOptions = graph.nodes.map(node => ({
        label: `${node.name}`,
        description: `${node.type} • ${countComponents(node.components)} components`,
        detail: `File: ${node.filePath}`,
        flow: node
    }));

    flowOptions.unshift({
        label: '📊 All Flows (Detailed View)',
        description: 'Render all flows together with detailed components',
        detail: 'Single diagram showing all flows with nested components',
        flow: null as any
    });

    const flowChoice = await vscode.window.showQuickPick(flowOptions, {
        placeHolder: 'Select a flow to render individually, or choose "All Flows"',
        matchOnDetail: true,
        ignoreFocusOut: true
    });

    if (!flowChoice) {
        outputChannel.appendLine('❌ No flow selected');
        return;
    }

    if (flowChoice.flow === null) {
        // Render all flows with detailed view
        await renderSingleDiagram(context, label, graph, metadata, 'detailed', outputChannel);
        return;
    }

    // Create a new graph with just this flow
    const singleFlowGraph: MuleFlowGraph = {
        nodes: [flowChoice.flow],
        edges: graph.edges.filter(edge => 
            edge.from === flowChoice.flow.id || edge.to === flowChoice.flow.id
        )
    };

    const mermaid = buildMermaidDefinitionWithMode(singleFlowGraph, 'detailed');
    outputChannel.appendLine(`📊 Generated individual flow diagram for "${flowChoice.flow.name}"`);
    
    renderDiagramWebview(
        context,
        `${flowChoice.flow.name} (Individual)`,
        singleFlowGraph,
        mermaid,
        {
            ...metadata,
            artifactName: `${metadata.artifactName} - ${flowChoice.flow.name}`
        }
    );
}

async function promptForLocalJarFile(outputChannel: vscode.OutputChannel): Promise<JSZip | undefined> {
    const selection = await vscode.window.showErrorMessage(
        'CloudHub 2.0 Application Artifact Not Available',
        {
            modal: true,
            detail: 'The application artifact cannot be downloaded from CloudHub or Exchange.\n\n' +
                   'This commonly happens when applications are deployed from local JAR files rather than Exchange assets.\n\n' +
                   'To generate the diagram, you can provide the original JAR file from your local machine.'
        },
        'Select Local JAR File',
        'Cancel'
    );

    if (selection !== 'Select Local JAR File') {
        return undefined;
    }

    const fileUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
            'Mule Applications': ['jar'],
            'All Files': ['*']
        },
        title: 'Select Mule Application JAR File'
    });

    if (!fileUri || fileUri.length === 0) {
        return undefined;
    }

    const filePath = fileUri[0].fsPath;
    outputChannel.appendLine(`📁 Selected local JAR file: ${filePath}`);

    try {
        const fileBuffer = fs.readFileSync(filePath);
        outputChannel.appendLine(`📦 Read ${fileBuffer.length} bytes from local JAR file`);
        
        const zip = await JSZip.loadAsync(fileBuffer);
        outputChannel.appendLine('✅ Successfully loaded JAR file as ZIP archive');
        
        return zip;
    } catch (error) {
        outputChannel.appendLine(`❌ Failed to read local JAR file: ${error}`);
        vscode.window.showErrorMessage(`Failed to read the selected JAR file: ${error}`);
        return undefined;
    }
}
