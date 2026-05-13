targetScope = 'resourceGroup'

param location string
param appName string
param planId string
param containerImage string
param storageAccountName string

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'app,linux,container'
  identity: {
    type: 'SystemAssigned'
  }
  tags: {
    app: 'mydenicek'
    service: 'docs-api'
  }
  properties: {
    serverFarmId: planId
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${containerImage}'
      appSettings: [
        {
          name: 'WEBSITES_PORT'
          value: '8080'
        }
        {
          name: 'TABLE_ACCOUNT_NAME'
          value: storageAccountName
        }
      ]
    }
  }
}

resource stagingSlot 'Microsoft.Web/sites/slots@2023-12-01' = {
  name: '${app.name}/staging'
  location: location
  properties: {
    serverFarmId: planId
    siteConfig: {
      linuxFxVersion: 'DOCKER|${containerImage}'
    }
  }
}

output principalId string = app.identity.principalId
output webAppId string = app.id
