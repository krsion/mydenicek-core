targetScope = 'resourceGroup'

resource syncAsg 'Microsoft.Network/applicationSecurityGroups@2024-05-01' = {
  name: 'asg-sync'
  location: resourceGroup().location
  tags: {
    app: 'mydenicek'
  }
}

resource apiAsg 'Microsoft.Network/applicationSecurityGroups@2024-05-01' = {
  name: 'asg-api'
  location: resourceGroup().location
  tags: {
    app: 'mydenicek'
  }
}
