targetScope = 'resourceGroup'

@description('Name of the Application Security Group.')
param name string

@description('Azure region for the ASG.')
param location string

@description('Resource tags.')
param tags object = {}

resource asg 'Microsoft.Network/applicationSecurityGroups@2023-11-01' = {
  name: name
  location: location
  tags: tags
  properties: {}
}

output asgId string = asg.id
output asgName string = asg.name
