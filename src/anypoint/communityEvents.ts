import * as vscode from 'vscode';
import axios from 'axios';

interface CommunityEvent {
    id: string;
    title: string;
    description_short: string;
    start_date: string;
    url: string;
    chapter: {
        country: string;
        city: string;
        name: string;
    };
    event_type_title: string;
    tags: string[];
}

interface EventsResponse {
    results: CommunityEvent[];
}

export async function showCommunityEvents(context: vscode.ExtensionContext) {
    try {
        // Show loading message
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Loading MuleSoft Community Events...",
            cancellable: false
        }, async () => {
            
            const response = await axios.get<EventsResponse>('https://meetups.mulesoft.com/api/search/?result_types=upcoming_event&country_code=Earth');
            const events = response.data.results;

            if (!events || events.length === 0) {
                vscode.window.showInformationMessage('No upcoming MuleSoft community events found.');
                return;
            }

            // Ask user for filtering preference
            const filterOptions = [
                'Show All Events',
                'Filter by Region',
                'Filter by Date Range',
                'Filter by Event Type'
            ];

            const selectedFilter = await vscode.window.showQuickPick(filterOptions, {
                placeHolder: 'How would you like to view the events?'
            });

            if (!selectedFilter) {
                return;
            }

            let filteredEvents = events;

            // Apply filters based on user selection
            switch (selectedFilter) {
                case 'Filter by Region':
                    filteredEvents = await filterByRegion(events);
                    break;
                case 'Filter by Date Range':
                    filteredEvents = await filterByDateRange(events);
                    break;
                case 'Filter by Event Type':
                    filteredEvents = await filterByEventType(events);
                    break;
            }

            if (filteredEvents.length === 0) {
                vscode.window.showInformationMessage('No events match your filter criteria.');
                return;
            }

            // Create and show the webview
            const panel = vscode.window.createWebviewPanel(
                'communityEvents',
                'MuleSoft Community Events',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            panel.webview.html = generateEventsTableHTML(filteredEvents);
        });

    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to fetch community events: ${error.message}`);
    }
}

async function filterByRegion(events: CommunityEvent[]): Promise<CommunityEvent[]> {
    const regions = [...new Set(events.map(event => event.chapter.country))].sort();
    
    const selectedRegion = await vscode.window.showQuickPick(regions, {
        placeHolder: 'Select a region/country'
    });

    if (!selectedRegion) {
        return [];
    }

    return events.filter(event => event.chapter.country === selectedRegion);
}

async function filterByDateRange(events: CommunityEvent[]): Promise<CommunityEvent[]> {
    const dateOptions = [
        'Next 7 days',
        'Next 30 days',
        'Next 3 months',
        'All upcoming'
    ];

    const selectedRange = await vscode.window.showQuickPick(dateOptions, {
        placeHolder: 'Select date range'
    });

    if (!selectedRange) {
        return [];
    }

    const now = new Date();
    let cutoffDate: Date;

    switch (selectedRange) {
        case 'Next 7 days':
            cutoffDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            break;
        case 'Next 30 days':
            cutoffDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            break;
        case 'Next 3 months':
            cutoffDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
            break;
        default:
            return events;
    }

    return events.filter(event => {
        const eventDate = new Date(event.start_date);
        return eventDate <= cutoffDate;
    });
}

async function filterByEventType(events: CommunityEvent[]): Promise<CommunityEvent[]> {
    const eventTypes = [...new Set(events.map(event => event.event_type_title))].sort();
    
    const selectedType = await vscode.window.showQuickPick(eventTypes, {
        placeHolder: 'Select event type'
    });

    if (!selectedType) {
        return [];
    }

    return events.filter(event => event.event_type_title === selectedType);
}

function generateEventsTableHTML(events: CommunityEvent[]): string {
    const tableRows = events.map(event => {
        const eventDate = new Date(event.start_date);
        const formattedDate = eventDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const tags = event.tags.slice(0, 3).join(', '); // Limit to first 3 tags
        const location = `${event.chapter.city}, ${event.chapter.country}`;

        return `
            <tr>
                <td><a href="${event.url}" style="color: #007acc; text-decoration: none;">${event.title}</a></td>
                <td>${formattedDate}</td>
                <td>${location}</td>
                <td>${event.event_type_title}</td>
                <td>${event.chapter.name}</td>
                <td style="max-width: 200px; word-wrap: break-word;">${event.description_short}</td>
                <td>${tags}</td>
            </tr>
        `;
    }).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>MuleSoft Community Events</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    margin: 20px;
                    background: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                .header {
                    margin-bottom: 20px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 10px;
                }
                .events-count {
                    font-size: 14px;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 15px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    background: var(--vscode-editor-background);
                }
                th {
                    background: var(--vscode-list-headerBackground);
                    color: var(--vscode-list-headerForeground);
                    padding: 12px 8px;
                    text-align: left;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    font-weight: 600;
                    font-size: 13px;
                    white-space: nowrap;
                }
                td {
                    padding: 12px 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    font-size: 13px;
                    vertical-align: top;
                }
                tr:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                a {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: none;
                }
                a:hover {
                    text-decoration: underline;
                }
                .refresh-info {
                    margin-top: 20px;
                    padding: 10px;
                    background: var(--vscode-textBlockQuote-background);
                    border-left: 4px solid var(--vscode-textBlockQuote-border);
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>
                    <svg width="24" height="24" viewBox="0 0 24 24" style="vertical-align: middle; margin-right: 8px;">
                        <path fill="#00A0DF" d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.568 7.178l-2.83 2.83c-.39.39-1.024.39-1.414 0-.39-.39-.39-1.024 0-1.414l2.83-2.83c.39-.39 1.024-.39 1.414 0 .39.39.39 1.024 0 1.414zM12 16c-2.206 0-4-1.794-4-4s1.794-4 4-4 4 1.794 4 4-1.794 4-4 4zm0-6c-1.103 0-2 .897-2 2s.897 2 2 2 2-.897 2-2-.897-2-2-2z"/>
                        <path fill="#FF6B35" d="M8.432 7.178c.39-.39 1.024-.39 1.414 0 .39.39.39 1.024 0 1.414l-2.83 2.83c-.39.39-1.024.39-1.414 0-.39-.39-.39-1.024 0-1.414l2.83-2.83z"/>
                    </svg>
                    MuleSoft Community Events
                </h1>
                <div class="events-count">Showing ${events.length} upcoming event(s)</div>
            </div>
            
            <table>
                <thead>
                    <tr>
                        <th>Event Title</th>
                        <th>Date & Time</th>
                        <th>Location</th>
                        <th>Type</th>
                        <th>Chapter</th>
                        <th>Description</th>
                        <th>Tags</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
            
            <div class="refresh-info">
                💡 Tip: Run the command again to see the latest events. Click on event titles to open registration pages.
            </div>
        </body>
        </html>
    `;
}