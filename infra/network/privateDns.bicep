targetScope = 'resourceGroup'

param frontendVnetId string
param syncVnetId string
param apiVnetId string
param dataVnetId string

resource blobZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.blob.core.windows.net'
  location: 'global'
}

resource tableZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.table.core.windows.net'
  location: 'global'
}

resource fileZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.file.core.windows.net'
  location: 'global'
}

var links = [
  {
    zoneName: blobZone.name
    vnetId: frontendVnetId
    name: 'blob-frontend-link'
  }
  {
    zoneName: blobZone.name
    vnetId: syncVnetId
    name: 'blob-sync-link'
  }
  {
    zoneName: blobZone.name
    vnetId: apiVnetId
    name: 'blob-api-link'
  }
  {
    zoneName: blobZone.name
    vnetId: dataVnetId
    name: 'blob-data-link'
  }
]

resource blobLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [for item in links: {
  name: '${item.zoneName}/${item.name}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: item.vnetId
    }
  }
}]

// TODO: add full links for tableZone and fileZone with service-specific naming.
