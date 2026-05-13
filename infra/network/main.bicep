targetScope = 'resourceGroup'

@description('Environment name (dev or prod).')
@allowed(['dev', 'prod'])
param environment string

@description('Azure region for all network resources.')
param location string = 'westeurope'

@description('Resource tags.')
param tags object = {}

// ── Hub VNet ──────────────────────────────────────────────────────────────────
module hub 'hubVnet.bicep' = {
  name: 'hubVnet-${environment}'
  params: {
    name: 'vnet-hub-${environment}'
    location: location
    tags: tags
  }
}

// ── Spoke VNets (one per service) ─────────────────────────────────────────────
var spokes = [
  { name: 'sync',        addressPrefix: '10.1.0.0/16' }
  { name: 'docs-api',    addressPrefix: '10.2.0.0/16' }
  { name: 'acl',         addressPrefix: '10.3.0.0/16' }
  { name: 'attachments', addressPrefix: '10.4.0.0/16' }
]

module spokeVnets 'spokeVnet.bicep' = [for spoke in spokes: {
  name: 'spokeVnet-${spoke.name}-${environment}'
  params: {
    name: 'vnet-${spoke.name}-${environment}'
    location: location
    addressPrefix: spoke.addressPrefix
    tags: tags
  }
}]

// ── VNet peering: hub ↔ each spoke ────────────────────────────────────────────
module peerings 'peering.bicep' = [for (spoke, i) in spokes: {
  name: 'peering-${spoke.name}-${environment}'
  params: {
    hubVnetName:  hub.outputs.vnetName
    spokeVnetName: spokeVnets[i].outputs.vnetName
    hubVnetId:    hub.outputs.vnetId
    spokeVnetId:  spokeVnets[i].outputs.vnetId
  }
  dependsOn: [hub, spokeVnets]
}]

// ── Application Security Group ────────────────────────────────────────────────
module asg 'asg.bicep' = {
  name: 'asg-${environment}'
  params: {
    name: 'asg-mydenicek-${environment}'
    location: location
    tags: tags
  }
}

// ── Network Security Group ────────────────────────────────────────────────────
module nsg 'nsg.bicep' = {
  name: 'nsg-${environment}'
  params: {
    name: 'nsg-mydenicek-${environment}'
    location: location
    asgId: asg.outputs.asgId
    tags: tags
  }
}

// ── Private DNS zones ─────────────────────────────────────────────────────────
module privateDns 'privateDns.bicep' = {
  name: 'privateDns-${environment}'
  params: {
    hubVnetId: hub.outputs.vnetId
    tags: tags
  }
}

// ── Standard Load Balancer ────────────────────────────────────────────────────
module lb 'loadBalancer.bicep' = {
  name: 'lb-${environment}'
  params: {
    name: 'lb-mydenicek-${environment}'
    location: location
    publicIpName: 'pip-lb-mydenicek-${environment}'
    tags: tags
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
output hubVnetId string = hub.outputs.vnetId
output hubVnetName string = hub.outputs.vnetName
output spokeVnetIds array = [for (spoke, i) in spokes: spokeVnets[i].outputs.vnetId]
output nsgId string = nsg.outputs.nsgId
output asgId string = asg.outputs.asgId
output kvPrivateDnsZoneId string = privateDns.outputs.kvPrivateDnsZoneId
output blobPrivateDnsZoneId string = privateDns.outputs.blobPrivateDnsZoneId
output tablePrivateDnsZoneId string = privateDns.outputs.tablePrivateDnsZoneId
output filePrivateDnsZoneId string = privateDns.outputs.filePrivateDnsZoneId
output lbId string = lb.outputs.lbId
