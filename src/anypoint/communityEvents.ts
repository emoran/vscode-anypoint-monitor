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

            panel.onDidDispose(() => {
                // Panel disposed - cleanup if needed
            });

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
    const { wrapWebviewHtml, summaryCard, badge, escapeHtml: uiEscapeHtml, escapeAttr } = require('../webview/ui-kit');

    const tableRows = events.map(event => {
        const eventDate = new Date(event.start_date);
        const formattedDate = eventDate.toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const tags = event.tags.slice(0, 3).map((t: string) => badge(uiEscapeHtml(t), 'default')).join(' ');
        const location = `${uiEscapeHtml(event.chapter.city)}, ${uiEscapeHtml(event.chapter.country)}`;

        return `
            <tr class="am-row">
                <td><a href="${escapeAttr(event.url)}" style="color:var(--am-text-link);text-decoration:none">${uiEscapeHtml(event.title)}</a></td>
                <td style="white-space:nowrap">${uiEscapeHtml(formattedDate)}</td>
                <td>${location}</td>
                <td>${badge(uiEscapeHtml(event.event_type_title), 'info')}</td>
                <td>${uiEscapeHtml(event.chapter.name)}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${uiEscapeHtml(event.description_short)}</td>
                <td>${tags}</td>
            </tr>`;
    }).join('');

    const regions = [...new Set(events.map(e => e.chapter.country))];

    const body = `
    <div class="am-container">
        <div class="am-page-header">
            <div>
                <h1>MuleSoft Community Events</h1>
                <div class="am-page-header-meta">
                    ${badge(`${events.length} upcoming`, 'info', true)}
                    ${badge(`${regions.length} regions`, 'default', true)}
                </div>
            </div>
        </div>

        <div class="am-summary-cards">
            ${summaryCard({ icon: '📅', value: events.length, label: 'Upcoming Events', animationDelay: '0.1s' })}
            ${summaryCard({ icon: '🌍', value: regions.length, label: 'Regions', animationDelay: '0.15s' })}
        </div>

        <div class="am-table-container">
            <table class="am-table">
                <thead><tr>
                    <th>Event Title</th><th>Date &amp; Time</th><th>Location</th>
                    <th>Type</th><th>Chapter</th><th>Description</th><th>Tags</th>
                </tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>

        <div style="margin-top:16px;padding:10px 14px;background:var(--am-bg-surface);border:1px solid var(--am-border);border-radius:var(--am-radius-md);font-size:12px;color:var(--am-text-muted)">
            Run the command again to see the latest events. Click on event titles to open registration pages.
        </div>
    </div>`;

    return wrapWebviewHtml({ title: 'MuleSoft Community Events', body });
}