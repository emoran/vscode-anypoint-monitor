import * as vscode from 'vscode';

/**
 * GitHub Star Prompt State Keys
 */
const STAR_PROMPT_STATE_KEYS = {
  COMMAND_COUNT: 'github.commandExecutionCount',
  DONT_ASK_AGAIN: 'github.starPromptDontAskAgain',
  PROMPT_SHOWN: 'github.starPromptShown',
  LAST_PROMPT_COUNT: 'github.lastPromptCount',
} as const;

/**
 * Configuration Constants
 */
const STAR_PROMPT_CONFIG = {
  GITHUB_URL: 'https://github.com/emoran/vscode-anypoint-monitor',
  FIRST_PROMPT_THRESHOLD: 3,
  SUBSEQUENT_PROMPT_INTERVAL: 15,
} as const;

/**
 * GitHub Star Prompt State Manager
 */
export class StarPromptManager {
  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Tracks a successful command execution and shows prompt if threshold is met
   */
  async trackCommandExecution(): Promise<void> {
    try {
      // Check if user has opted out permanently
      const dontAskAgain = this.context.globalState.get<boolean>(
        STAR_PROMPT_STATE_KEYS.DONT_ASK_AGAIN,
        false
      );

      if (dontAskAgain) {
        return;
      }

      // Increment command count
      const currentCount = this.context.globalState.get<number>(
        STAR_PROMPT_STATE_KEYS.COMMAND_COUNT,
        0
      );
      const newCount = currentCount + 1;
      await this.context.globalState.update(
        STAR_PROMPT_STATE_KEYS.COMMAND_COUNT,
        newCount
      );

      // Check if we should show the prompt
      if (await this.shouldShowPrompt(newCount)) {
        await this.showStarPrompt();
      }
    } catch (error: any) {
      console.error('StarPromptManager: Error tracking command execution:', error);
    }
  }

  /**
   * Determines if the star prompt should be shown based on current count
   */
  private async shouldShowPrompt(currentCount: number): Promise<boolean> {
    const promptShown = this.context.globalState.get<boolean>(
      STAR_PROMPT_STATE_KEYS.PROMPT_SHOWN,
      false
    );
    const lastPromptCount = this.context.globalState.get<number>(
      STAR_PROMPT_STATE_KEYS.LAST_PROMPT_COUNT,
      0
    );

    // Show first prompt after 3 successful commands
    if (!promptShown && currentCount >= STAR_PROMPT_CONFIG.FIRST_PROMPT_THRESHOLD) {
      return true;
    }

    // Show subsequent prompts after 15 more commands (if user clicked "Maybe Later")
    if (promptShown && (currentCount - lastPromptCount) >= STAR_PROMPT_CONFIG.SUBSEQUENT_PROMPT_INTERVAL) {
      return true;
    }

    return false;
  }

  /**
   * Shows the GitHub star prompt to the user
   */
  private async showStarPrompt(): Promise<void> {
    try {
      const currentCount = this.context.globalState.get<number>(
        STAR_PROMPT_STATE_KEYS.COMMAND_COUNT,
        0
      );

      const action = await vscode.window.showInformationMessage(
        '⭐ Enjoying Anypoint Monitor? Star us on GitHub to show your support!',
        '⭐ Star on GitHub',
        'Maybe Later',
        "Don't Ask Again"
      );

      // Update prompt shown flag and last prompt count
      await this.context.globalState.update(
        STAR_PROMPT_STATE_KEYS.PROMPT_SHOWN,
        true
      );
      await this.context.globalState.update(
        STAR_PROMPT_STATE_KEYS.LAST_PROMPT_COUNT,
        currentCount
      );

      // Handle user actions
      if (action === '⭐ Star on GitHub') {
        await this.openGitHubRepo();
      } else if (action === "Don't Ask Again") {
        await this.context.globalState.update(
          STAR_PROMPT_STATE_KEYS.DONT_ASK_AGAIN,
          true
        );
        console.log('StarPromptManager: User opted out of star prompts');
      }
    } catch (error: any) {
      console.error('StarPromptManager: Error showing star prompt:', error);
    }
  }

  /**
   * Opens the GitHub repository in the user's default browser
   */
  private async openGitHubRepo(): Promise<void> {
    try {
      const uri = vscode.Uri.parse(STAR_PROMPT_CONFIG.GITHUB_URL);
      await vscode.env.openExternal(uri);
      console.log('StarPromptManager: Opened GitHub repository');
    } catch (error: any) {
      console.error('StarPromptManager: Error opening GitHub URL:', error);
      vscode.window.showErrorMessage(
        `Failed to open GitHub: ${error.message || error}`
      );
    }
  }

  /**
   * Resets all star prompt state (useful for testing)
   */
  async resetState(): Promise<void> {
    await this.context.globalState.update(STAR_PROMPT_STATE_KEYS.COMMAND_COUNT, undefined);
    await this.context.globalState.update(STAR_PROMPT_STATE_KEYS.DONT_ASK_AGAIN, undefined);
    await this.context.globalState.update(STAR_PROMPT_STATE_KEYS.PROMPT_SHOWN, undefined);
    await this.context.globalState.update(STAR_PROMPT_STATE_KEYS.LAST_PROMPT_COUNT, undefined);
    console.log('StarPromptManager: State reset');
  }

  /**
   * Gets current state (useful for debugging)
   */
  async getState(): Promise<{
    commandCount: number;
    dontAskAgain: boolean;
    promptShown: boolean;
    lastPromptCount: number;
  }> {
    return {
      commandCount: this.context.globalState.get(STAR_PROMPT_STATE_KEYS.COMMAND_COUNT, 0),
      dontAskAgain: this.context.globalState.get(STAR_PROMPT_STATE_KEYS.DONT_ASK_AGAIN, false),
      promptShown: this.context.globalState.get(STAR_PROMPT_STATE_KEYS.PROMPT_SHOWN, false),
      lastPromptCount: this.context.globalState.get(STAR_PROMPT_STATE_KEYS.LAST_PROMPT_COUNT, 0),
    };
  }
}

/**
 * HTML and CSS for GitHub star banner in webviews
 */
export function getGitHubStarBannerHtml(): string {
  return /* html */ `
    <div id="github-star-banner" class="github-star-banner">
      <div class="github-star-banner-content">
        <span class="github-star-banner-text">
          ⭐ Star us on GitHub if you find this useful!
        </span>
        <a
          href="#"
          class="github-star-banner-link"
          onclick="handleGitHubStarClick(event)"
        >
          GitHub
        </a>
        <button
          class="github-star-banner-dismiss"
          onclick="dismissGitHubBanner()"
          title="Dismiss"
          aria-label="Dismiss banner"
        >
          ✕
        </button>
      </div>
    </div>
  `;
}

/**
 * CSS styles for GitHub star banner
 */
export function getGitHubStarBannerStyles(): string {
  return /* css */ `
    .github-star-banner {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background-color: var(--vscode-editor-background, #1e1e1e);
      border-top: 1px solid var(--vscode-panel-border, #454545);
      padding: 8px 16px;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.2);
    }

    .github-star-banner-content {
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: 100%;
    }

    .github-star-banner-text {
      color: var(--vscode-foreground, #cccccc);
      margin: 0;
      padding: 0;
    }

    .github-star-banner-link {
      color: var(--vscode-textLink-foreground, #4daafc);
      text-decoration: none;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 3px;
      transition: background-color 0.2s ease;
    }

    .github-star-banner-link:hover {
      background-color: var(--vscode-list-hoverBackground, rgba(77, 170, 252, 0.1));
      text-decoration: underline;
    }

    .github-star-banner-link:active {
      color: var(--vscode-textLink-activeForeground, #75beff);
    }

    .github-star-banner-dismiss {
      background: none;
      border: none;
      color: var(--vscode-foreground, #cccccc);
      cursor: pointer;
      padding: 4px 8px;
      margin-left: 8px;
      font-size: 16px;
      line-height: 1;
      opacity: 0.7;
      transition: opacity 0.2s ease;
      border-radius: 3px;
    }

    .github-star-banner-dismiss:hover {
      opacity: 1;
      background-color: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.1));
    }

    .github-star-banner-dismiss:active {
      background-color: var(--vscode-list-activeSelectionBackground, rgba(255, 255, 255, 0.15));
    }

    .github-star-banner-hidden {
      display: none;
    }

    /* Adjust body padding to account for fixed banner */
    body.github-banner-visible {
      padding-bottom: 45px;
    }
  `;
}

/**
 * JavaScript for GitHub star banner interaction
 */
export function getGitHubStarBannerScript(): string {
  return /* javascript */ `
    <script>
      (function() {
        const GITHUB_URL = '${STAR_PROMPT_CONFIG.GITHUB_URL}';
        const BANNER_DISMISSED_KEY = 'github.starBannerDismissed';

        // Check if banner was previously dismissed
        function isBannerDismissed() {
          try {
            const state = vscode.getState() || {};
            return state[BANNER_DISMISSED_KEY] === true;
          } catch (e) {
            return false;
          }
        }

        // Initialize banner visibility
        function initBanner() {
          const banner = document.getElementById('github-star-banner');
          if (!banner) return;

          if (isBannerDismissed()) {
            banner.classList.add('github-star-banner-hidden');
          } else {
            document.body.classList.add('github-banner-visible');
          }
        }

        // Handle GitHub link click
        window.handleGitHubStarClick = function(event) {
          event.preventDefault();
          try {
            const vscode = acquireVsCodeApi();
            vscode.postMessage({
              command: 'openGitHubRepo',
              url: GITHUB_URL
            });
          } catch (error) {
            console.error('Failed to send GitHub open message:', error);
            // Fallback: try opening directly (may not work in webview)
            window.open(GITHUB_URL, '_blank');
          }
        };

        // Handle banner dismissal
        window.dismissGitHubBanner = function() {
          const banner = document.getElementById('github-star-banner');
          if (banner) {
            banner.classList.add('github-star-banner-hidden');
            document.body.classList.remove('github-banner-visible');

            // Persist dismissal state
            try {
              const vscode = acquireVsCodeApi();
              const currentState = vscode.getState() || {};
              currentState[BANNER_DISMISSED_KEY] = true;
              vscode.setState(currentState);
            } catch (error) {
              console.error('Failed to save banner dismissal state:', error);
            }
          }
        };

        // Initialize on load
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', initBanner);
        } else {
          initBanner();
        }
      })();
    </script>
  `;
}
