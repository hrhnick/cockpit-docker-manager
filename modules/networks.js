// Docker Manager - Network Management Module (Simplified)
(function() {
    'use strict';

    // Dependencies
    function resources() { return window.DockerManager.resources; }

    // Create resource manager with minimal configuration
    const networkManager = resources().createResourceManager({
        resourceType: 'networks',
        resourceName: 'network',
        dockerCommand: 'network',
        
        modalConfig: {
            modalId: 'create-network-modal',
            title: 'Create Network',
            fields: [
                {
                    name: 'network-name',
                    label: 'Network name',
                    type: 'text',
                    placeholder: 'e.g., frontend, backend',
                    required: true,
                    helperText: 'Name for the Docker network'
                },
                {
                    name: 'network-driver',
                    label: 'Driver',
                    type: 'select',
                    options: [
                        { value: 'bridge', label: 'bridge' },
                        { value: 'host', label: 'host' },
                        { value: 'overlay', label: 'overlay' },
                        { value: 'macvlan', label: 'macvlan' },
                        { value: 'none', label: 'none' }
                    ],
                    defaultValue: 'bridge',
                    helperText: 'Network driver type. Bridge is the default for standalone containers.'
                },
                {
                    name: 'network-internal',
                    label: 'Internal network',
                    type: 'checkbox',
                    helperText: 'Restrict external access to the network'
                },
                {
                    name: 'network-ipv6',
                    label: 'Enable IPv6',
                    type: 'checkbox',
                    helperText: 'Enable IPv6 networking on this network'
                },
                {
                    name: 'network-subnet',
                    label: 'Subnet',
                    type: 'text',
                    placeholder: '172.20.0.0/16',
                    helperText: 'Custom subnet in CIDR format (optional)'
                },
                {
                    name: 'network-gateway',
                    label: 'Gateway',
                    type: 'text',
                    placeholder: '172.20.0.1',
                    helperText: 'Custom gateway for the subnet (optional)'
                }
            ],
            validators: {
                'network-subnet': function(value) {
                    if (!value) return null;
                    if (!/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(value)) {
                        return 'Invalid subnet format. Use CIDR notation (e.g., 172.20.0.0/16)';
                    }
                    return null;
                },
                'network-gateway': function(value) {
                    if (!value) return null;
                    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
                        return 'Invalid gateway format. Use IP address (e.g., 172.20.0.1)';
                    }
                    return null;
                }
            },
            submitLabel: 'Create'
        }
    });

    // Export public interface
    window.DockerManager.networks = {
        loadNetworks: networkManager.loadResources,
        renderNetworks: networkManager.renderResources,
        removeNetwork: networkManager.removeResource,
        pruneNetworks: networkManager.pruneResources,
        showCreateNetworkModal: networkManager.showCreateModal,
        hideCreateNetworkModal: networkManager.hideCreateModal
    };

})();
