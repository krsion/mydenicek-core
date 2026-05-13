targetScope = 'resourceGroup'

@description('Azure region for the scheduled query rules.')
param location string

@description('Resource ID of the Log Analytics Workspace to query.')
param lawId string

@description('Resource ID of the Action Group to trigger.')
param actionGroupId string

@description('Resource tags.')
param tags object = {}

// ── 1. Signature failures alert ───────────────────────────────────────────────
// KQL mirrors infra/monitor/kql/signature-failures.kql
resource signatureFailuresAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-signature-failures'
  location: location
  tags: tags
  properties: {
    description: 'Fires when CRDT event signature verification failures exceed threshold.'
    enabled: true
    severity: 1
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [lawId]
    criteria: {
      allOf: [
        {
          query: '''
AppTraces
| where Message contains "signature-failure"
| extend docId = tostring(Properties["docId"]), peerId = tostring(Properties["peerId"]), reason = tostring(Properties["reason"])
| summarize Failures = count() by docId, peerId, reason, bin(TimeGenerated, 5m)
| where Failures > 0
'''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [actionGroupId]
    }
  }
}

// ── 2. Failed sign-ins alert ──────────────────────────────────────────────────
// KQL mirrors infra/monitor/kql/failed-signins.kql
resource failedSignInsAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-failed-signins'
  location: location
  tags: tags
  properties: {
    description: 'Fires when a single user exceeds 5 failed sign-ins in 5 minutes.'
    enabled: true
    severity: 2
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [lawId]
    criteria: {
      allOf: [
        {
          query: '''
SigninLogs
| where ResultType != 0
| where AppDisplayName == "mydenicek"
| summarize FailedAttempts = count() by UserPrincipalName, bin(TimeGenerated, 5m)
| where FailedAttempts > 5
'''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [actionGroupId]
    }
  }
}

output signatureFailuresAlertId string = signatureFailuresAlert.id
output failedSignInsAlertId string = failedSignInsAlert.id
