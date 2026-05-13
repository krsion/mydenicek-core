targetScope = 'resourceGroup'

@description('Resource ID of the hub VNet to link all private DNS zones to.')
param hubVnetId string

@description('Resource tags.')
param tags object = {}

// ── Private DNS zones for Azure PaaS private endpoints ───────────────────────

resource kvDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
  tags: tags
}

resource blobDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.blob.core.windows.net'
  location: 'global'
  tags: tags
}

resource tableDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.table.core.windows.net'
  location: 'global'
  tags: tags
}

resource fileDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.file.core.windows.net'
  location: 'global'
  tags: tags
}

// ── VNet links — zones resolve inside the hub (and transitively via peering) ──

resource kvLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: kvDnsZone
  name: 'link-hub-kv'
  location: 'global'
  tags: tags
  properties: {
    virtualNetwork: { id: hubVnetId }
    registrationEnabled: false
  }
}

resource blobLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: blobDnsZone
  name: 'link-hub-blob'
  location: 'global'
  tags: tags
  properties: {
    virtualNetwork: { id: hubVnetId }
    registrationEnabled: false
  }
}

resource tableLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: tableDnsZone
  name: 'link-hub-table'
  location: 'global'
  tags: tags
  properties: {
    virtualNetwork: { id: hubVnetId }
    registrationEnabled: false
  }
}

resource fileLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: fileDnsZone
  name: 'link-hub-file'
  location: 'global'
  tags: tags
  properties: {
    virtualNetwork: { id: hubVnetId }
    registrationEnabled: false
  }
}

output kvPrivateDnsZoneId string = kvDnsZone.id
output blobPrivateDnsZoneId string = blobDnsZone.id
output tablePrivateDnsZoneId string = tableDnsZone.id
output filePrivateDnsZoneId string = fileDnsZone.id
