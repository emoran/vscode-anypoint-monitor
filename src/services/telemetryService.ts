import * as vscode from 'vscode';
import type { TelemetryClient } from 'applicationinsights';
import * as os from 'os';
import { TELEMETRY_CONNECTION_STRING } from './telemetryConfig';

function getConnectionString(): string {
    const config = vscode.workspace.getConfiguration('anypointMonitor');
    return config.get<string>('telemetry.connectionString')?.trim()
        || process.env.ANYPOINT_MONITOR_APPINSIGHTS_CONNECTION_STRING
        || TELEMETRY_CONNECTION_STRING;
}

function isTelemetryEnabledByUser(): boolean {
    const config = vscode.workspace.getConfiguration('anypointMonitor');
    const extensionSetting = config.get<boolean>('telemetry.enabled', true);
    const vscodeSetting = vscode.env.isTelemetryEnabled;
    return extensionSetting && vscodeSetting;
}

// Telemetry event names
export const TelemetryEvents = {
    EXTENSION_ACTIVATED: 'extension_activated',
    EXTENSION_DEACTIVATED: 'extension_deactivated',
    COMMAND_EXECUTED: 'command_executed',
    LOGIN_SUCCESS: 'login_success',
    LOGIN_FAILED: 'login_failed',
    ERROR_OCCURRED: 'error_occurred',
    FEATURE_USED: 'feature_used',
    SESSION_START: 'session_start',
    SESSION_END: 'session_end'
};

class TelemetryService {
    private client: TelemetryClient | null = null;
    private isEnabled: boolean = false;
    private sessionId: string = '';
    private sessionStartTime: number = 0;
    private extensionVersion: string = '';

    /**
     * Initialize the telemetry service
     */
    async initialize(context: vscode.ExtensionContext): Promise<void> {
        try {
            const connectionString = getConnectionString();
            this.isEnabled = isTelemetryEnabledByUser() && connectionString.length > 0;

            if (!this.isEnabled) {
                console.log('Telemetry is disabled or not configured');
                return;
            }

            let appInsights: typeof import('applicationinsights');
            try {
                appInsights = await import('applicationinsights');
            } catch (error) {
                console.error('Failed to load Application Insights SDK:', error);
                this.isEnabled = false;
                return;
            }

            // Get extension version
            const extension = vscode.extensions.getExtension('EdgarMoran.anypoint-monitor');
            this.extensionVersion = extension?.packageJSON?.version || 'unknown';

            // Initialize Application Insights
            appInsights.setup(connectionString)
                .setAutoCollectRequests(false)
                .setAutoCollectPerformance(false, false)
                .setAutoCollectExceptions(true)
                .setAutoCollectDependencies(false)
                .setAutoCollectConsole(false)
                .setAutoCollectPreAggregatedMetrics(false)
                .setSendLiveMetrics(true) // Enable live metrics for real-time viewing
                .setUseDiskRetryCaching(true)
                .start();

            this.client = appInsights.defaultClient;

            // Set common properties for all telemetry
            this.client.commonProperties = {
                'extension.version': this.extensionVersion,
                'vscode.version': vscode.version,
                'os.platform': os.platform(),
                'os.release': os.release(),
                'os.arch': os.arch(),
                'locale': vscode.env.language
            };
            this.client.context.tags[this.client.context.keys.userId] = vscode.env.machineId;

            // Generate session ID
            this.sessionId = this.generateSessionId();
            this.sessionStartTime = Date.now();

            // Track extension activation
            this.trackEvent(TelemetryEvents.EXTENSION_ACTIVATED, {
                sessionId: this.sessionId
            });
            this.trackEvent(TelemetryEvents.SESSION_START, {
                sessionId: this.sessionId
            });

            console.log('Telemetry service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize telemetry:', error);
            this.isEnabled = false;
        }
    }

    /**
     * Generate a unique session ID
     */
    private generateSessionId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Track a custom event
     */
    trackEvent(eventName: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number }): void {
        if (!this.isEnabled || !this.client) {
            return;
        }

        try {
            this.client.trackEvent({
                name: eventName,
                properties: {
                    sessionId: this.sessionId,
                    ...properties
                },
                measurements
            });
        } catch (error) {
            console.error('Failed to track event:', error);
        }
    }

    /**
     * Track a command execution
     */
    trackCommand(commandName: string, success: boolean = true, errorMessage?: string): void {
        if (!this.isEnabled || !this.client) {
            return;
        }

        const properties: { [key: string]: string } = {
            commandName: commandName,
            success: success.toString(),
            sessionId: this.sessionId
        };

        if (errorMessage) {
            properties.errorMessage = errorMessage.substring(0, 500); // Limit error message length
        }

        this.trackEvent(TelemetryEvents.COMMAND_EXECUTED, properties);
    }

    /**
     * Track feature usage
     */
    trackFeature(featureName: string, details?: { [key: string]: string }): void {
        this.trackEvent(TelemetryEvents.FEATURE_USED, {
            featureName,
            ...details
        });
    }

    /**
     * Track an error
     */
    trackError(error: Error, context?: string): void {
        if (!this.isEnabled || !this.client) {
            return;
        }

        try {
            this.client.trackException({
                exception: error,
                properties: {
                    context: context || 'unknown',
                    sessionId: this.sessionId
                }
            });
        } catch (err) {
            console.error('Failed to track error:', err);
        }
    }

    /**
     * Track a metric
     */
    trackMetric(name: string, value: number): void {
        if (!this.isEnabled || !this.client) {
            return;
        }

        try {
            this.client.trackMetric({
                name,
                value
            });
        } catch (error) {
            console.error('Failed to track metric:', error);
        }
    }

    /**
     * Track page view (for webviews)
     */
    trackPageView(pageName: string, properties?: { [key: string]: string }): void {
        if (!this.isEnabled || !this.client) {
            return;
        }

        try {
            this.client.trackPageView({
                id: this.sessionId,
                name: pageName,
                properties: {
                    sessionId: this.sessionId,
                    ...properties
                }
            });
        } catch (error) {
            console.error('Failed to track page view:', error);
        }
    }

    /**
     * Flush telemetry data and dispose
     */
    async dispose(): Promise<void> {
        if (!this.isEnabled || !this.client) {
            return;
        }

        try {
            // Track session end with duration
            const sessionDuration = (Date.now() - this.sessionStartTime) / 1000; // in seconds
            this.trackEvent(TelemetryEvents.EXTENSION_DEACTIVATED, {
                sessionId: this.sessionId
            }, {
                sessionDurationSeconds: sessionDuration
            });

            // Flush all pending telemetry
            await new Promise<void>((resolve) => {
                this.client?.flush();
                // Timeout after 2 seconds
                setTimeout(resolve, 2000);
            });
        } catch (error) {
            console.error('Failed to dispose telemetry:', error);
        }
    }

    /**
     * Check if telemetry is enabled
     */
    isTrackingEnabled(): boolean {
        return this.isEnabled;
    }
}

// Export singleton instance
export const telemetryService = new TelemetryService();
