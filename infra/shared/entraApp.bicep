targetScope = 'resourceGroup'

// TODO: Run az ad app create manually; this is a stub.
// Full Entra app registration requires Microsoft Graph permissions that
// Bicep deployment scripts cannot reliably acquire in all tenants.
// Recommended manual steps:
//   az ad app create --display-name "mydenicek" --sign-in-audience AzureADMyOrg
//   az ad app credential reset --id <appId> --append
// Store the client secret in Key Vault after creation.

@description('Azure region for the deployment script resource (not the Entra object).')
param location string = 'westeurope'

@description('Display name for the Entra app registration.')
param appDisplayName string = 'mydenicek'

@description('Resource ID of a User-Assigned Managed Identity with Directory.ReadWrite.All (Graph) permission.')
// TODO: create this identity and grant it the required Graph API permissions before deploying
param scriptIdentityId string = 'TODO_SCRIPT_IDENTITY_RESOURCE_ID'

@description('Resource tags.')
param tags object = {}

// Deployment script stub — outputs a placeholder appId until a real identity
// with Graph API permissions is wired in.
resource entraAppScript 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: 'ds-entra-app-${appDisplayName}'
  location: location
  tags: tags
  kind: 'AzureCLI'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      // TODO: replace scriptIdentityId with the real UAMI resource ID
      '${scriptIdentityId}': {}
    }
  }
  properties: {
    azCliVersion: '2.57.0'
    retentionInterval: 'P1D'
    // TODO: this script requires the UAMI to have Directory.ReadWrite.All on Microsoft Graph
    scriptContent: '''
      set -e
      EXISTING=$(az ad app list --display-name "${APP_DISPLAY_NAME}" --query "[0].appId" -o tsv 2>/dev/null || true)
      if [ -z "$EXISTING" ]; then
        APP_ID=$(az ad app create --display-name "${APP_DISPLAY_NAME}" --sign-in-audience AzureADMyOrg --query appId -o tsv)
      else
        APP_ID=$EXISTING
      fi
      echo "{\"appId\": \"$APP_ID\"}" > $AZ_SCRIPTS_OUTPUT_PATH
    '''
    environmentVariables: [
      {
        name: 'APP_DISPLAY_NAME'
        value: appDisplayName
      }
    ]
    cleanupPreference: 'OnSuccess'
  }
}

output appId string = entraAppScript.properties.outputs.appId
