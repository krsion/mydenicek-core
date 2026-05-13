targetScope = 'subscription'

param location string = deployment().location
param prefix string = 'mydenicek'
param monitorRgName string = '${prefix}-monitor-rg'

resource monitorRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: monitorRgName
  location: location
  tags: {
    app: 'mydenicek'
    env: 'monitor'
  }
}

module actionGroup './actionGroup.bicep' = {
  name: 'monitor-action-group'
  scope: resourceGroup(monitorRg.name)
  params: {
    location: location
    actionGroupName: '${prefix}-ops-ag'
  }
}

module diagnostic './diagnosticSettings.bicep' = {
  name: 'monitor-diagnostics'
  scope: resourceGroup(monitorRg.name)
}

module metricAlerts './metricAlerts.bicep' = {
  name: 'monitor-metric-alerts'
  scope: resourceGroup(monitorRg.name)
  params: {
    actionGroupId: actionGroup.outputs.actionGroupId
  }
}

module logAlerts './logAlerts.bicep' = {
  name: 'monitor-log-alerts'
  scope: resourceGroup(monitorRg.name)
  params: {
    actionGroupId: actionGroup.outputs.actionGroupId
  }
}
