targetScope = 'resourceGroup'

param zoneName string

resource privateDnsZone 'Microsoft.Network/privateDnsZones@2024-05-01' = {
  name: zoneName
  location: 'global'
  tags: {
    app: 'mydenicek'
  }
}

output privateDnsZoneId string = privateDnsZone.id
