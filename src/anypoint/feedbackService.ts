import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface FeedbackItem {
    id: string;
    timestamp: string;
    type: 'bug' | 'feature' | 'improvement' | 'general';
    rating: number;
    subject: string;
    description: string;
    userContext?: {
        version: string;
        os: string;
        userId?: string;
        email?: string;
        firstName?: string;
        lastName?: string;
        username?: string;
        organizationId?: string;
        organizationName?: string;
        organizationDomain?: string;
    };
}

function getSlackWebhookUrl(): string {
    try {
        const configPath = path.join(__dirname, '../../config/secrets.json');
        const configData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configData);
        return config.slackWebhookUrl || '';
    } catch (error) {
        console.error('Failed to load webhook URL from config:', error);
        return '';
    }
}

export async function provideFeedback(context: vscode.ExtensionContext) {
    try {
        // Step 1: Select feedback type
        const feedbackTypes = [
            { label: '🐛 Bug Report', value: 'bug' as const },
            { label: '✨ Feature Request', value: 'feature' as const },
            { label: '🔧 Improvement Suggestion', value: 'improvement' as const },
            { label: '💬 General Feedback', value: 'general' as const }
        ];

        const selectedType = await vscode.window.showQuickPick(
            feedbackTypes.map(type => type.label),
            { placeHolder: 'What type of feedback would you like to provide?' }
        );

        if (!selectedType) {
            return;
        }

        const feedbackType = feedbackTypes.find(type => type.label === selectedType)?.value;
        if (!feedbackType) {
            return;
        }

        // Step 2: Get rating (1-5 stars)
        const ratingOptions = [
            { label: '⭐⭐⭐⭐⭐ Excellent (5)', value: 5 },
            { label: '⭐⭐⭐⭐ Good (4)', value: 4 },
            { label: '⭐⭐⭐ Average (3)', value: 3 },
            { label: '⭐⭐ Poor (2)', value: 2 },
            { label: '⭐ Very Poor (1)', value: 1 }
        ];

        const selectedRating = await vscode.window.showQuickPick(
            ratingOptions.map(rating => rating.label),
            { placeHolder: 'How would you rate your overall experience?' }
        );

        if (!selectedRating) {
            return;
        }

        const rating = ratingOptions.find(r => r.label === selectedRating)?.value || 3;

        // Step 3: Get subject/title
        const subject = await vscode.window.showInputBox({
            prompt: 'Enter a brief subject for your feedback',
            placeHolder: 'e.g., "Login issue with OAuth" or "Add support for CloudHub 3.0"',
            validateInput: (value) => {
                if (!value || value.trim().length < 5) {
                    return 'Subject must be at least 5 characters long';
                }
                return null;
            }
        });

        if (!subject) {
            return;
        }

        // Step 4: Get detailed description
        const description = await vscode.window.showInputBox({
            prompt: 'Provide detailed feedback (optional but helpful)',
            placeHolder: 'Describe your issue, suggestion, or feedback in detail...',
            value: getTemplateForType(feedbackType)
        });

        // Step 5: Create and send feedback to Slack
        const userInfo = await getUserInfo(context);
        const feedback: FeedbackItem = {
            id: generateId(),
            timestamp: new Date().toISOString(),
            type: feedbackType,
            rating,
            subject: subject.trim(),
            description: description?.trim() || '',
            userContext: {
                version: vscode.extensions.getExtension('EdgarMoran.anypoint-monitor')?.packageJSON.version || 'unknown',
                os: process.platform,
                userId: userInfo?.id,
                email: userInfo?.email,
                firstName: userInfo?.firstName,
                lastName: userInfo?.lastName,
                username: userInfo?.username,
                organizationId: userInfo?.organization?.id,
                organizationName: userInfo?.organization?.name,
                organizationDomain: userInfo?.organization?.domain
            }
        };

        const sent = await sendFeedbackToSlack(feedback);
        if (!sent) {
            vscode.window.showErrorMessage('Failed to send feedback. Please try again.');
            return;
        }

        // Step 6: Show options for what to do next
        const nextStepOptions = [
            'Submit to GitHub Issues',
            'Done'
        ];

        const nextStep = await vscode.window.showQuickPick(nextStepOptions, {
            placeHolder: 'Feedback sent to Slack! What would you like to do next?'
        });

        if (nextStep === 'Submit to GitHub Issues') {
            await submitToGitHub(feedback);
        }

        vscode.window.showInformationMessage('Thank you for your feedback! 🙏');

    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to save feedback: ${error.message}`);
    }
}

async function sendFeedbackToSlack(feedback: FeedbackItem): Promise<boolean> {
    try {
        const typeEmoji = {
            bug: '🐛',
            feature: '✨',
            improvement: '🔧',
            general: '💬'
        }[feedback.type];

        const ratingStars = '⭐'.repeat(feedback.rating);
        
        // Format user display name
        const userName = feedback.userContext?.firstName && feedback.userContext?.lastName 
            ? `${feedback.userContext.firstName} ${feedback.userContext.lastName}`
            : feedback.userContext?.username || 'Anonymous User';

        const userEmail = feedback.userContext?.email || 'N/A';
        
        const slackMessage = {
            text: `New Feedback for Anypoint Monitor Extension - ${feedback.type}: ${feedback.subject}`,
            blocks: [
                {
                    type: "header",
                    text: {
                        type: "plain_text",
                        text: `${typeEmoji} New ${feedback.type.charAt(0).toUpperCase() + feedback.type.slice(1)} Feedback`
                    }
                },
                {
                    type: "section",
                    fields: [
                        {
                            type: "mrkdwn",
                            text: `*Subject:*\n${feedback.subject}`
                        },
                        {
                            type: "mrkdwn",
                            text: `*Rating:*\n${ratingStars} (${feedback.rating}/5)`
                        },
                        {
                            type: "mrkdwn",
                            text: `*Type:*\n${typeEmoji} ${feedback.type}`
                        },
                        {
                            type: "mrkdwn",
                            text: `*Date:*\n${new Date(feedback.timestamp).toLocaleString()}`
                        }
                    ]
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Description:*\n${feedback.description || 'No description provided'}`
                    }
                },
                {
                    type: "section",
                    fields: [
                        {
                            type: "mrkdwn",
                            text: `*User:*\n${userName}`
                        },
                        {
                            type: "mrkdwn",
                            text: `*Email:*\n${userEmail}`
                        },
                        {
                            type: "mrkdwn",
                            text: `*Organization:*\n${feedback.userContext?.organizationName || 'N/A'}`
                        },
                        {
                            type: "mrkdwn",
                            text: `*Version:*\n${feedback.userContext?.version}`
                        }
                    ]
                },
                {
                    type: "context",
                    elements: [
                        {
                            type: "mrkdwn",
                            text: `User ID: ${feedback.userContext?.userId || 'N/A'} | Org ID: ${feedback.userContext?.organizationId || 'N/A'} | OS: ${feedback.userContext?.os} | Feedback ID: ${feedback.id}`
                        }
                    ]
                }
            ]
        };


        const webhookUrl = getSlackWebhookUrl();
        if (!webhookUrl) {
            throw new Error('Slack webhook URL not configured');
        }

        const response = await axios.post(webhookUrl, slackMessage, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        return response.status === 200;
    } catch (error) {
        console.error('Failed to send feedback to Slack:', error);
        return false;
    }
}

async function getUserInfo(context: vscode.ExtensionContext): Promise<any | undefined> {
    try {
        const userInfoStr = await context.secrets.get('anypoint.userInfo');
        if (userInfoStr) {
            return JSON.parse(userInfoStr);
        }
    } catch (error) {
        // Ignore error - user might not be logged in
    }
    return undefined;
}


async function submitToGitHub(feedback: FeedbackItem) {
    const repoUrl = 'https://github.com/emoran/anypoint-monitor/issues/new';
    const issueTitle = encodeURIComponent(`[${feedback.type.toUpperCase()}] ${feedback.subject}`);
    const issueBody = encodeURIComponent(`
**Feedback Type:** ${feedback.type}
**Rating:** ${'⭐'.repeat(feedback.rating)} (${feedback.rating}/5)
**Version:** ${feedback.userContext?.version}
**OS:** ${feedback.userContext?.os}
**Date:** ${new Date(feedback.timestamp).toLocaleString()}

**Description:**
${feedback.description}

---
*This issue was created via the Anypoint Monitor VS Code extension feedback feature.*
    `.trim());

    const githubUrl = `${repoUrl}?title=${issueTitle}&body=${issueBody}`;
    
    const openInBrowser = await vscode.window.showInformationMessage(
        'Open GitHub to create an issue with your feedback?',
        'Open GitHub',
        'Copy URL',
        'Cancel'
    );

    if (openInBrowser === 'Open GitHub') {
        vscode.env.openExternal(vscode.Uri.parse(githubUrl));
    } else if (openInBrowser === 'Copy URL') {
        vscode.env.clipboard.writeText(githubUrl);
        vscode.window.showInformationMessage('GitHub URL copied to clipboard!');
    }
}

function getTemplateForType(type: FeedbackItem['type']): string {
    switch (type) {
        case 'bug':
            return `Steps to reproduce:
1. 
2. 
3. 

Expected behavior:

Actual behavior:

Additional context:`;
        case 'feature':
            return `Feature description:

Use case:

Benefit:

Additional notes:`;
        case 'improvement':
            return `Current behavior:

Suggested improvement:

Why this would be helpful:`;
        default:
            return '';
    }
}

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

