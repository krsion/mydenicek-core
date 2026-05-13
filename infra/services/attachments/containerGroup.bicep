targetScope = 'resourceGroup'

@description('Name of the container group.')
param name string

@description('Azure region.')
param location string

@description('Login server of the ACR (e.g. crmydenicek.azurecr.io).')
param acrLoginServer string

@description('Docker image tag to deploy.')
param imageTag string = 'latest'

@description('Name of the storage account for blob delegation.')
param storageAccountName string

@description('Application Insights connection string.')
param appInsightsConnStr string

@description('Whether to enable authentication in the app.')
param authEnabled bool = true

@description('Resource tags.')
param tags object = {}

resource containerGroup 'Microsoft.ContainerInstance/containerGroups@2023-05-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    // System-assigned MI enables user-delegation SAS tokens without storage account keys
    type: 'SystemAssigned'
  }
  properties: {
    osType: 'Linux'
    restartPolicy: 'Always'
    // ACR image pulled via managed identity — no registry credentials needed when AcrPull is assigned
    imageRegistryCredentials: []
    containers: [
      {
        name: 'attachments'
        properties: {
          image: '${acrLoginServer}/attachments:${imageTag}'
          ports: [
            {
              port: 3000
              protocol: 'TCP'
            }
          ]
          resources: {
            requests: {
              cpu: 1
              // Bicep requires json() to express decimal literals for memoryInGB
              memoryInGB: json('1.5')
            }
          }
          environmentVariables: [
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsightsConnStr
            }
            {
              name: 'AUTH_ENABLED'
              value: string(authEnabled)
            }
            {
              name: 'STORAGE_ACCOUNT_NAME'
              value: storageAccountName
            }
          ]
        }
      }
    ]
    ipAddress: {
      type: 'Public'
      ports: [
        {
          port: 3000
          protocol: 'TCP'
        }
      ]
    }
  }
}

output containerGroupId string = containerGroup.id
output principalId string = containerGroup.identity.principalId
output ipAddress string = containerGroup.properties.ipAddress.ip
