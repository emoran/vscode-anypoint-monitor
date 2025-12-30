# 🧪 Anypoint Monitor - Complete Testing Checklist

## 📝 **Pre-Testing Setup**

- [ ] Extension compiled successfully (`npm run compile`)
- [ ] No TypeScript errors
- [ ] Extension running in Development Host (F5)
- [ ] Have valid Anypoint Platform credentials
- [ ] Have access to multi-region accounts (US, EU, GOV)
- [ ] Have access to multi-business group organization

---

## 🔐 **1. Authentication Commands**

### **1.1. Login**
- [ ] **Command**: `AM: Login into Anypoint Platform`
- [ ] Opens region selector (US, EU, GOV)
- [ ] OAuth flow opens in browser
- [ ] Successfully authenticates
- [ ] Status bar shows account name
- [ ] Account saved in Account Manager
- [ ] If multi-BG: Shows prompt to select business group

### **1.2. Logout**
- [ ] **Command**: `AM: Logout`
- [ ] Confirmation dialog appears
- [ ] Revokes access token
- [ ] Updates status bar to "No Anypoint Account"
- [ ] Account marked as expired in Account Manager

### **1.3. Account Manager**
- [ ] **Command**: `AM: Account Manager`
- [ ] Shows all stored accounts
- [ ] Shows account status (authenticated/expired)
- [ ] Shows region (US/EU/GOV)
- [ ] Can switch between accounts
- [ ] Can add new account
- [ ] Can refresh account status
- [ ] Can change region (marks as expired)
- [ ] Can re-authenticate expired accounts

### **1.4. Retrieve Access Token**
- [ ] **Command**: `AM: Retrieve Access Token`
- [ ] Shows current OAuth token
- [ ] Can copy token to clipboard
- [ ] Token is valid (check with API call)

---

## 🏢 **2. Business Group Commands (NEW!)**

### **2.1. Select Business Group**
- [ ] **Command**: `AM: Select Business Group`
- [ ] Opens business group selector webview
- [ ] Shows organization hierarchy
- [ ] Shows root organization with badge
- [ ] Shows child business groups
- [ ] Search functionality works
- [ ] Can select a business group
- [ ] Progress notification appears
- [ ] Success message: "Environments refreshed..."
- [ ] Status bar updates with BG name
- [ ] **If Developer Utilities open**: Auto-closes

### **2.2. Status Bar Quick Actions**
- [ ] Click status bar
- [ ] Shows quick pick menu:
  - [ ] "Switch Account"
  - [ ] "Switch Business Group" (if multi-BG)
  - [ ] "Current Business Group" (info)
  - [ ] "Refresh"
- [ ] "Switch Business Group" opens BG selector
- [ ] "Refresh" updates status bar

### **2.3. Command Palette Menu**
- [ ] Open sidebar: Anypoint Monitor
- [ ] Expand "Settings & Maintenance"
- [ ] "Select Business Group" appears
- [ ] Clicking opens BG selector

### **2.4. Auto-Prompt on Login**
- [ ] Login with multi-BG account
- [ ] After 1 second, prompt appears
- [ ] Options: "Select Business Group", "Use Root Organization", "Ask Me Later"
- [ ] Each option works correctly

---

## 👤 **3. User & Organization Commands**

### **3.1. My Information**
- [ ] **Command**: `AM: My Information`
- [ ] Shows user profile data
- [ ] Shows organization details
- [ ] **If BG selected**: Shows BG context

### **3.2. Organization Details**
- [ ] **Command**: `AM: Organization Details`
- [ ] Shows org plan details
- [ ] Shows vCore limits
- [ ] Shows worker usage
- [ ] **If BG selected**: Shows BG org ID

### **3.3. Subscription Expiration**
- [ ] **Command**: `AM: Subscription Expiration`
- [ ] Shows subscription end date
- [ ] Shows days remaining

---

## ☁️ **4. CloudHub Application Commands**

### **4.1. CloudHub 2.0 Applications**
- [ ] **Command**: `AM: Show Cloudhub 2.0 Applications`
- [ ] Prompts for environment selection
- [ ] **If BG selected**: Shows BG environments only
- [ ] Shows applications list
- [ ] **Header shows**: Environment name + Business Group name
- [ ] Shows application status (Running/Stopped)
- [ ] Shows statistics (total apps, vCores)
- [ ] Can click application for details
- [ ] Search/filter works
- [ ] Export to CSV works

### **4.2. CloudHub 1.0 Applications**
- [ ] **Command**: `AM: Show Cloudhub 1.0 Applications`
- [ ] Prompts for environment selection
- [ ] **If BG selected**: Shows BG environments only
- [ ] Shows applications list
- [ ] **Header shows**: Environment name + Business Group name
- [ ] Shows application status
- [ ] Shows statistics
- [ ] Can click application for details
- [ ] Search/filter works
- [ ] Export to CSV works

### **4.3. Application Command Center**
- [ ] **Command**: `AM: Application Command Center`
- [ ] Prompts for environment
- [ ] **If BG selected**: Uses BG context
- [ ] Shows application operations
- [ ] Can start/stop/restart apps
- [ ] Bulk operations work

### **4.4. Application Diagram**
- [ ] **Command**: `AM: Application Diagram`
- [ ] Prompts for environment and app
- [ ] **If BG selected**: Shows BG apps
- [ ] Generates Mermaid diagram
- [ ] Shows application architecture

---

## 🖥️ **5. Hybrid/On-Premises Commands**

### **5.1. Hybrid Applications**
- [ ] **Command**: `AM: Show Hybrid Applications`
- [ ] Prompts for environment
- [ ] **If BG selected**: Uses BG environments
- [ ] Shows hybrid apps
- [ ] Shows server details

### **5.2. Hybrid Servers**
- [ ] **Command**: `AM: Show Hybrid Servers`
- [ ] Prompts for environment
- [ ] **If BG selected**: Uses BG environments
- [ ] Shows registered servers
- [ ] Shows server status

### **5.3. Hybrid Server Groups**
- [ ] **Command**: `AM: Show Hybrid Server Groups`
- [ ] Prompts for environment
- [ ] **If BG selected**: Uses BG environments
- [ ] Shows server groups

### **5.4. Hybrid Clusters**
- [ ] **Command**: `AM: Show Hybrid Clusters`
- [ ] Prompts for environment
- [ ] **If BG selected**: Uses BG environments
- [ ] Shows cluster information

---

## 🔌 **6. API Management Commands**

### **6.1. Retrieve API Manager APIs**
- [ ] **Command**: `AM: Retrieve API Manager APIs`
- [ ] Prompts for environment
- [ ] **If BG selected**: Shows BG APIs
- [ ] Lists all APIs
- [ ] Shows API details
- [ ] Can view API policies

### **6.2. Audit APIs**
- [ ] **Command**: `AM: Audit APIs`
- [ ] Prompts for environment
- [ ] **If BG selected**: Uses BG context
- [ ] Shows API audit information
- [ ] Shows policy compliance

---

## 📊 **7. Monitoring & Logs Commands**

### **7.1. Real-Time Logs**
- [ ] **Command**: `AM: Real-Time Logs`
- [ ] Prompts for environment and app
- [ ] **If BG selected**: Shows BG apps
- [ ] Streams logs in real-time
- [ ] Filter by log level works
- [ ] Search functionality works
- [ ] Export logs works
- [ ] Auto-scroll works

### **7.2. AnypointMQ Statistics**
- [ ] **Command**: `AM: AnypointMQ Statistics`
- [ ] Prompts for environment
- [ ] **If BG selected**: Uses BG environment
- [ ] Shows MQ regions
- [ ] Shows queue statistics
- [ ] Shows message counts

### **7.3. Environment Comparison Table**
- [ ] **Command**: `AM: Environment Comparison Table`
- [ ] **If BG selected**: Uses BG environments
- [ ] Shows side-by-side comparison
- [ ] Shows all environments
- [ ] Shows application differences

---

## 🛠️ **8. Developer Tools Commands**

### **8.1. Developer Utilities**
- [ ] **Command**: `AM: Developer Utilities`
- [ ] Shows environments list
- [ ] **If BG selected**: Shows BG environments ✅
- [ ] Shows client credentials
- [ ] **Shows BG context**: Organization name matches BG
- [ ] Can show/hide secrets
- [ ] Can copy credentials
- [ ] **When BG switches**: Panel auto-closes

### **8.2. DataWeave Playground**
- [ ] **Command**: `AM: DataWeave Playground`
- [ ] Opens playground editor
- [ ] Can write DataWeave scripts
- [ ] Can test transformations
- [ ] Syntax highlighting works

---

## 🌐 **9. Community & Support Commands**

### **9.1. Community Events**
- [ ] **Command**: `AM: MuleSoft Community Events`
- [ ] Shows upcoming events
- [ ] Shows event details
- [ ] Can register for events

### **9.2. Provide Feedback**
- [ ] **Command**: `AM: Provide Feedback`
- [ ] Opens feedback form
- [ ] Can submit feedback
- [ ] Links to GitHub issues

---

## ⚙️ **10. Settings & Maintenance Commands**

### **10.1. Delete All Accounts & Data**
- [ ] **Command**: `AM: Delete All Accounts & Data`
- [ ] Shows confirmation dialog
- [ ] Warns about data loss
- [ ] Deletes all accounts
- [ ] Clears all stored data
- [ ] Status bar updates

### **10.2. Migrate Legacy Account**
- [ ] **Command**: `AM: Migrate Legacy Account to Multi-Account`
- [ ] Detects legacy account
- [ ] Migrates to new system
- [ ] Preserves tokens and data

### **10.3. Refresh Command Palette**
- [ ] **Command**: `AM: Refresh Command Palette`
- [ ] Refreshes sidebar tree view
- [ ] Updates command list

---

## 🧪 **11. Business Group Integration Tests**

### **Test Scenario 1: Single Business Group**
- [ ] Login with single-BG account
- [ ] No prompt appears
- [ ] All commands use root org
- [ ] Developer Utilities shows root environments

### **Test Scenario 2: Multiple Business Groups**
- [ ] Login with multi-BG account
- [ ] Prompt appears after 1 second
- [ ] Select "bg-1"
- [ ] Status bar shows "bg-1"
- [ ] All commands scoped to bg-1:
  - [ ] CloudHub apps show bg-1 apps
  - [ ] Developer Utilities shows bg-1 environments
  - [ ] API Manager shows bg-1 APIs
  - [ ] Hybrid apps show bg-1 deployments

### **Test Scenario 3: Switching Business Groups**
- [ ] Start with root org
- [ ] Open Developer Utilities (shows root envs)
- [ ] Keep panel open
- [ ] Switch to "bg-1"
- [ ] Developer Utilities closes automatically ✅
- [ ] Reopen Developer Utilities
- [ ] Shows bg-1 environments ✅
- [ ] Switch to "bg-2"
- [ ] Developer Utilities closes again ✅
- [ ] Reopen Developer Utilities
- [ ] Shows bg-2 environments ✅

### **Test Scenario 4: Multi-Account with Different BGs**
- [ ] Login to Account A (has bg-a1, bg-a2)
- [ ] Select bg-a1
- [ ] Verify commands use bg-a1
- [ ] Switch to Account B (has bg-b1, bg-b2)
- [ ] Select bg-b1
- [ ] Verify commands use bg-b1
- [ ] Switch back to Account A
- [ ] Verify still using bg-a1 (persisted)

### **Test Scenario 5: Restart Persistence**
- [ ] Select "bg-1" business group
- [ ] Close VSCode completely
- [ ] Reopen VSCode
- [ ] Status bar shows "bg-1" ✅
- [ ] Developer Utilities shows bg-1 environments ✅
- [ ] All commands still use bg-1 ✅

---

## 🔄 **12. Multi-Region Tests**

### **12.1. US Region**
- [ ] Login to US account
- [ ] All commands work
- [ ] Base URL: `anypoint.mulesoft.com`

### **12.2. EU Region**
- [ ] Login to EU account
- [ ] All commands work
- [ ] Base URL: `eu1.anypoint.mulesoft.com`

### **12.3. GOV Region**
- [ ] Login to GOV account
- [ ] All commands work
- [ ] Base URL: `gov.anypoint.mulesoft.com`

### **12.4. Region Switching**
- [ ] Have US account
- [ ] Change region to EU (marks expired)
- [ ] Re-authenticate
- [ ] All commands use EU base URL

---

## 📱 **13. Status Bar Tests**

- [ ] Shows account name
- [ ] Shows organization name
- [ ] **Shows business group** (if selected and different from root)
- [ ] Clickable → Opens quick actions
- [ ] Updates when switching accounts
- [ ] Updates when switching business groups
- [ ] Shows warning icon when no account
- [ ] Shows error icon on authentication error

---

## 🎨 **14. UI/UX Tests**

### **Business Group Selector**
- [ ] Visual hierarchy clear
- [ ] Root org has badge
- [ ] Selected BG has checkmark
- [ ] Search works with debounce
- [ ] Refresh button works
- [ ] Loading state shows spinner
- [ ] Error state shows message

### **Webview Headers**
- [ ] Environment badge shows
- [ ] Business Group badge shows (if selected)
- [ ] Badges styled correctly
- [ ] Responsive on narrow screens

### **Command Palette Sidebar**
- [ ] All categories expand/collapse
- [ ] Icons display correctly
- [ ] "Select Business Group" in Settings section
- [ ] Refresh button works

---

## ⚡ **15. Performance Tests**

- [ ] BG hierarchy loads < 2 seconds
- [ ] BG switch completes < 3 seconds
- [ ] Environment refresh < 2 seconds
- [ ] Developer Utilities loads < 2 seconds
- [ ] No memory leaks on repeated BG switches
- [ ] Status bar updates immediately

---

## 🐛 **16. Error Handling Tests**

- [ ] Network error during BG fetch → Shows error message
- [ ] Invalid token → Auto-refresh token
- [ ] No business groups → Shows empty state
- [ ] API rate limit → Shows retry message
- [ ] No environments in BG → Shows gracefully
- [ ] Switching BG while API call in progress → Handles correctly

---

## 📊 **Test Coverage Summary**

| Category | Total Tests | Priority |
|----------|-------------|----------|
| Authentication | 12 | 🔴 Critical |
| Business Groups | 18 | 🔴 Critical |
| CloudHub Apps | 12 | 🟡 High |
| Hybrid/On-Prem | 8 | 🟢 Medium |
| API Management | 4 | 🟡 High |
| Monitoring | 9 | 🟡 High |
| Developer Tools | 4 | 🟡 High |
| Community | 4 | 🟢 Low |
| Settings | 6 | 🟡 High |
| Integration | 15 | 🔴 Critical |
| Multi-Region | 8 | 🟡 High |
| Status Bar | 8 | 🔴 Critical |
| UI/UX | 11 | 🟡 High |
| Performance | 6 | 🟡 High |
| Error Handling | 6 | 🔴 Critical |
| **TOTAL** | **131** | - |

---

## 🎯 **Priority Testing Order**

### **Phase 1: Critical Path (Must Pass)**
1. Login → Account Manager → Business Group Selection
2. Status bar updates
3. Developer Utilities with BG context
4. CloudHub applications with BG context
5. BG switching + auto-close
6. Restart persistence

### **Phase 2: High Priority**
1. All CloudHub commands
2. API Management commands
3. Monitoring commands
4. Multi-region support

### **Phase 3: Medium Priority**
1. Hybrid/On-Prem commands
2. Developer tools
3. UI/UX polish

### **Phase 4: Nice to Have**
1. Community features
2. Performance optimizations
3. Edge cases

---

## ✅ **Sign-Off Checklist**

- [ ] All Critical tests passing (Phase 1)
- [ ] All High Priority tests passing (Phase 2)
- [ ] No console errors during testing
- [ ] No TypeScript compilation errors
- [ ] Extension published to marketplace
- [ ] Documentation updated
- [ ] Release notes written

---

## 📝 **Notes**

- Test with **real Anypoint Platform accounts**
- Test across **all regions** (US, EU, GOV)
- Test with **multiple business groups**
- Test **switching between accounts**
- Test **persistence across restarts**
- Document any bugs found in GitHub Issues

---

**Last Updated**: 2025-01-30
**Version**: 0.0.53+
**Tester**: _____________
**Date**: _____________
