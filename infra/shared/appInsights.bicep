targetScope = 'resourceGroup'

param location string
param appInsightsName string
param logAnalyticsWorkspaceResourceId string

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: {
    app: 'mydenicek'
  }
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspaceResourceId
  }
}

output appInsightsId string = appInsights.id
