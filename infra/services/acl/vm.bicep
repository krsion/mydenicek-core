targetScope = 'resourceGroup'

@description('Name of the VM.')
param name string

@description('Azure region.')
param location string

@description('Resource ID of the subnet for the VM NIC.')
param subnetId string

@description('Resource ID of the Application Security Group.')
param asgId string

@description('Admin username for the VM OS.')
param adminUsername string

@description('SSH public key for the admin user.')
@secure()
param sshPublicKey string

@description('Storage account name (used as reference in CustomScript).')
param storageAccountName string

@description('Application Insights connection string.')
param appInsightsConnStr string

@description('Whether to enable authentication in the app.')
param authEnabled bool = true

@description('Resource tags.')
param tags object = {}

resource vm 'Microsoft.Compute/virtualMachines@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    // Spot configuration for cost savings
    priority: 'Spot'
    evictionPolicy: 'Deallocate'
    billingProfile: {
      maxPrice: -1
    }
    hardwareProfile: {
      vmSize: 'Standard_B1s'
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-server-jammy'
        sku: '22_04-lts-gen2'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'Standard_LRS'
        }
      }
      dataDisks: [
        {
          lun: 0
          createOption: 'Empty'
          diskSizeGB: 32
          managedDisk: {
            storageAccountType: 'StandardSSD_LRS'
          }
        }
      ]
    }
    osProfile: {
      computerName: name
      adminUsername: adminUsername
      // Password auth disabled; SSH key only
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
          properties: {
            primary: true
          }
        }
      ]
    }
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2023-11-01' = {
  name: '${name}-nic'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: {
            id: subnetId
          }
          applicationSecurityGroups: [
            {
              id: asgId
            }
          ]
          privateIPAllocationMethod: 'Dynamic'
        }
      }
    ]
  }
}

// Azure Monitor Agent (AMA) extension
resource amaExtension 'Microsoft.Compute/virtualMachines/extensions@2024-03-01' = {
  parent: vm
  name: 'AzureMonitorLinuxAgent'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.Monitor'
    type: 'AzureMonitorLinuxAgent'
    typeHandlerVersion: '1.0'
    autoUpgradeMinorVersion: true
    enableAutomaticUpgrade: true
    settings: {}
  }
}

// CustomScript extension — initialise data disk and start ACL service
resource customScriptExtension 'Microsoft.Compute/virtualMachines/extensions@2024-03-01' = {
  parent: vm
  name: 'CustomScript'
  location: location
  dependsOn: [amaExtension]
  properties: {
    publisher: 'Microsoft.Azure.Extensions'
    type: 'CustomScript'
    typeHandlerVersion: '2.1'
    autoUpgradeMinorVersion: true
    protectedSettings: {
      // Env vars are exported first so the shell script body can read them at runtime.
      // Bicep interpolation (${...}) resolves values at deploy time; $VAR inside the script
      // body expands at runtime when bash runs the inline command.
      commandToExecute: 'export STORAGE_ACCOUNT_NAME="${storageAccountName}" APPINSIGHTS_CONN_STR="${appInsightsConnStr}" AUTH_ENABLED="${string(authEnabled)}" && bash -c \'set -e; DATA_DISK=$(readlink -f /dev/disk/azure/scsi1/lun0); blkid "$DATA_DISK" 2>/dev/null || mkfs.ext4 "$DATA_DISK"; mkdir -p /data; mount "$DATA_DISK" /data; grep -q "$DATA_DISK" /etc/fstab || echo "$DATA_DISK /data ext4 defaults,nofail 0 2" >> /etc/fstab\''
    }
  }
}

output vmId string = vm.id
output vmName string = vm.name
output principalId string = vm.identity.principalId
