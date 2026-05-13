targetScope = 'resourceGroup'

@description('Display name for Entra app registration.')
param appName string

@description('Location for deployment script resources.')
param location string = resourceGroup().location

// TODO: Replace stub script with Graph API calls to create app registration,
// scopes, roles, and federated credentials.
resource script 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: '${appName}-entra-bootstrap'
  location: location
  kind: 'AzureCLI'
  properties: {
    azCliVersion: '2.61.0'
    retentionInterval: 'P1D'
    timeout: 'PT30M'
    scriptContent: 'echo "TODO: bootstrap Entra app registration"'
    cleanupPreference: 'OnSuccess'
  }
}

output scriptId string = script.id
