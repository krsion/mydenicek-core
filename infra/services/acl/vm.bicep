targetScope = 'resourceGroup'

param location string
param vmName string
@description('SSH public key for VM admin user.')
param adminSshPublicKey string = 'ssh-rsa TODO_REPLACE_WITH_REAL_KEY'

resource vm 'Microsoft.Compute/virtualMachines@2024-03-01' = {
  name: vmName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  tags: {
    app: 'mydenicek'
    service: 'acl'
  }
  properties: {
    hardwareProfile: {
      vmSize: 'Standard_B1s'
    }
    priority: 'Spot'
    evictionPolicy: 'Deallocate'
    billingProfile: {
      maxPrice: -1
    }
    osProfile: {
      computerName: vmName
      adminUsername: 'azureuser'
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/azureuser/.ssh/authorized_keys'
              keyData: adminSshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-server-jammy'
        sku: '22_04-lts'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'Standard_LRS'
        }
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: '/subscriptions/${subscription().subscriptionId}/resourceGroups/TODO/providers/Microsoft.Network/networkInterfaces/TODO'
        }
      ]
    }
  }
}

output principalId string = vm.identity.principalId
