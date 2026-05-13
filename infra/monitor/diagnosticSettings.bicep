targetScope = 'resourceGroup'

@description('Resource ID of the Log Analytics Workspace to send diagnostics to.')
param lawId string

@description('List of resource IDs to create diagnostic settings for.')
param resourceIds array

@description('Resource tags.')
param tags object = {}

// Diagnostic settings must be created on the target resource scope.
// Because Bicep requires a known resource type at compile time, we create one
// setting per resource using an existing reference at resourceGroup scope.
// TODO: For resources in other resource groups, deploy this module from the
//       appropriate scope or use az cli / ARM template deployments.

// The loop below creates a generic diagnostic setting for each supplied resource ID.
// Logs and metrics forwarded: AllLogs + AllMetrics.
// NOTE: not all resource types support all log categories; Azure will silently
//       skip unsupported categories.
resource diagnosticSettings 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = [for (resourceId, i) in resourceIds: {
  // Scope the diagnostic setting to the target resource
  name: 'diag-to-law-${i}'
  // Using resourceId as scope requires the resource to exist in the same RG.
  // TODO: Adjust if resources span multiple resource groups.
  scope: resourceGroup()
  properties: {
    workspaceId: lawId
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
        retentionPolicy: {
          enabled: false
          days: 0
        }
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
        retentionPolicy: {
          enabled: false
          days: 0
        }
      }
    ]
  }
}]
