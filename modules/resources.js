// Docker Manager - Shared Resource Management Module (Enhanced with Action Templates)
(function() {
    'use strict';

    // Lazy dependency getters
    function app() { return window.DockerManager.app; }
    function utils() { return window.DockerManager.utils; }
    function modals() { return window.DockerManager.modals; }
    function table() { return window.DockerManager.table; }

    // Resource action templates (Priority 4)
    const resourceActions = {
        remove: function(type, id, displayName) {
            return {
                confirm: `Remove ${type} "${displayName || id}"?`,
                confirmTitle: `Remove ${type.charAt(0).toUpperCase() + type.slice(1)}`,
                command: utils().dockerCommands.resource(type, 'rm', [id]).command,
                successMessage: `${type.charAt(0).toUpperCase() + type.slice(1)} removed successfully`,
                errorHandler: function(error) {
                    return handleResourceInUseError(error, type);
                }
            };
        },

        create: function(type, data) {
            const typeName = type.charAt(0).toUpperCase() + type.slice(1);
            return {
                message: `Creating ${type}...`,
                command: buildCreateCommand(type, data),
                successMessage: `${typeName} created successfully`,
                errorHandler: function(error) {
                    return utils().parseDockerError(error);
                }
            };
        },

        prune: function(type) {
            const config = getPruneConfig(type);
            return {
                confirm: config.message,
                confirmTitle: config.title,
                command: config.command,
                successHandler: function(result) {
                    const spaceFreed = parseSpaceFreed(result.data);
                    return `Unused ${type} removed${spaceFreed}`;
                }
            };
        },

        execute: function(action) {
            const self = this;
            
            // Handle confirmation if needed
            if (action.confirm) {
                return modals().confirm(action.confirm, {
                    title: action.confirmTitle || 'Confirm',
                    confirmLabel: action.confirmLabel || 'Yes',
                    cancelLabel: action.cancelLabel || 'No'
                }).then(function(confirmed) {
                    return confirmed ? self.runCommand(action) : null;
                });
            }
            
            return self.runCommand(action);
        },

        runCommand: function(action) {
            // Show progress notification if specified
            if (action.message) {
                utils().showNotification(action.message, 'info');
            }
            
            // Build command options
            const options = action.options || { superuser: 'require' };
            
            // Execute command with unified error handling
            return utils().errorHandler.handleAsync(
                utils().executeCommand(action.command, options),
                'docker-' + (action.type || 'command'),
                function(result) {
                    // Custom success handler
                    if (action.successHandler) {
                        const message = action.successHandler(result);
                        if (message) utils().showNotification(message, 'success');
                    } else if (action.successMessage) {
                        utils().showNotification(action.successMessage, 'success');
                    }
                    
                    // Trigger callback
                    if (action.onSuccess) action.onSuccess(result);
                    
                    return result;
                },
                function(error) {
                    // Custom error handler
                    if (action.errorHandler) {
                        const message = action.errorHandler(error);
                        if (message) utils().showNotification(message, 'error');
                    }
                    
                    // Trigger callback
                    if (action.onError) action.onError(error);
                    
                    return { success: false, error: error };
                }
            );
        }
    };

    // Common field configurations
    const commonFields = {
        name: {
            type: 'text',
            required: true,
            validator: function(value) {
                return utils().validators.resourceName(value);
            }
        },
        driver: {
            type: 'select',
            defaultValue: 'local'
        },
        labels: {
            type: 'textarea',
            rows: 3,
            placeholder: '# Labels in key=value format (one per line)\n# Example:\n# project=myapp\n# environment=production',
            helperText: 'Labels for organizing and filtering (optional)',
            validator: function(value) {
                return utils().validators.keyValue(value, 'Labels');
            }
        }
    };

    // Create a resource manager factory
    function createResourceManager(config) {
        const resourceType = config.resourceType; // 'images', 'networks', 'volumes'
        const resourceName = config.resourceName; // 'image', 'network', 'volume'
        const dockerCommand = config.dockerCommand; // 'image', 'network', 'volume'
        
        // Initialize table with enhanced configuration
        function initializeTable() {
            const tableId = resourceType + '-table';
            const columns = config.columns || getDefaultColumns(resourceType);
            
            // Add common renderers
            columns.forEach(function(col) {
                if (col.key === 'created' && !col.renderer) {
                    col.renderer = function(value) { return utils().formatDate(value); };
                    col.sortTransform = function(value) { return value ? new Date(value).getTime() : 0; };
                }
                if (col.key === 'size' && !col.sortTransform) {
                    col.sortTransform = utils().parseSize;
                }
                if (col.key === 'containers' && !col.renderer) {
                    col.renderer = function(value, item) { return renderContainerList(item.containers); };
                    col.sortTransform = function(value) { return value ? value.length : 0; };
                }
            });

            const finalTableConfig = Object.assign({
                columns: columns,
                searchColumns: config.searchColumns || getDefaultSearchColumns(resourceType),
                emptyMessage: config.emptyMessage || 'No ' + resourceType + ' found.',
                loadingMessage: 'Loading ' + resourceType + '...',
                errorMessage: 'Failed to load ' + resourceType,
                defaultSort: { column: 0, order: 'asc' }
            }, config.tableConfig || {});

            table().registerTable(tableId, finalTableConfig);
        }

        // Initialize modal with enhanced field handling
        function initializeModal() {
            if (!config.modalConfig) return;

            // Process fields to add common configurations
            const processedFields = (config.modalConfig.fields || []).map(function(field) {
                const commonField = commonFields[field.type];
                if (commonField) {
                    field = Object.assign({}, commonField, field);
                }
                return field;
            });

            const finalModalConfig = Object.assign({
                fields: processedFields,
                validators: Object.assign({}, getCommonValidators(resourceType), config.modalConfig.validators),
                onSubmit: function(formData) {
                    return createResource(formData);
                }
            }, config.modalConfig);

            modals().registerModal(config.modalConfig.modalId, finalModalConfig);
        }

        // Enhanced load function with batched operations (Priority 3)
        function loadResources() {
            const tableId = resourceType + '-table';
            table().showLoading(tableId);
            
            const listCommand = utils().dockerCommands.resource(dockerCommand, 'ls', ['--format', 'json']).command;
            
            utils().executeCommand(listCommand, { superuser: 'try', suppressError: true })
                .then(function(result) {
                    if (result.success) {
                        try {
                            const resources = result.data.split('\n')
                                .filter(function(line) { return line.trim(); })
                                .map(function(line) { return JSON.parse(line); });
                            
                            // Transform data to common format
                            const transformed = transformResourceData(resources, resourceType);
                            
                            // Load additional details with batching
                            if (config.loadDetails || shouldLoadDetails(resourceType)) {
                                loadResourceDetailsBatched(transformed, resourceType, config.loadDetails, renderResources);
                            } else {
                                app()[resourceType] = transformed;
                                renderResources();
                            }
                        } catch (e) {
                            showEmptyState();
                        }
                    } else {
                        showEmptyState();
                    }
                })
                .catch(function() {
                    table().showError(tableId, 'Failed to load ' + resourceType);
                });
        }

        // Generic render function
        function renderResources() {
            table().renderTable(resourceType + '-table', app()[resourceType]);
        }

        // Enhanced remove function using action templates (Priority 4)
        function removeResource(resourceId, resourceDisplayName) {
            const action = resourceActions.remove(resourceName, resourceId, resourceDisplayName);
            action.onSuccess = function() {
                loadResources();
            };
            
            resourceActions.execute(action);
        }

        // Enhanced prune function using action templates (Priority 4)
        function pruneResources() {
            const action = resourceActions.prune(resourceType);
            action.onSuccess = function() {
                loadResources();
            };
            
            resourceActions.execute(action);
        }

        // Generic show/hide modal functions
        function showCreateModal() {
            if (config.modalConfig && config.modalConfig.modalId) {
                modals().showModal(config.modalConfig.modalId);
            }
        }

        function hideCreateModal() {
            if (config.modalConfig && config.modalConfig.modalId) {
                modals().hideModal(config.modalConfig.modalId);
            }
        }

        // Generic create resource function using action templates (Priority 4)
        function createResource(formData) {
            const action = resourceActions.create(resourceName, formData);
            
            if (config.createCommand) {
                const commandInfo = typeof config.createCommand === 'function' ? 
                    config.createCommand(formData) : config.createCommand;
                
                action.command = commandInfo.command;
                action.message = commandInfo.message || action.message;
                action.successMessage = commandInfo.successMessage || action.successMessage;
            }
            
            return resourceActions.runCommand(action)
                .then(function(result) {
                    if (result.success) {
                        loadResources();
                        return true;
                    }
                    throw new Error(result.error);
                });
        }

        // Helper functions
        function showEmptyState() {
            app()[resourceType] = [];
            renderResources();
        }

        // Initialize on creation
        initializeTable();
        if (config.modalConfig) {
            initializeModal();
        }

        // Return public interface
        return {
            loadResources: loadResources,
            renderResources: renderResources,
            removeResource: removeResource,
            pruneResources: pruneResources,
            showCreateModal: showCreateModal,
            hideCreateModal: hideCreateModal
        };
    }

    // Check if we should load details
    function shouldLoadDetails(resourceType) {
        return ['images', 'networks', 'volumes'].includes(resourceType);
    }

    // Transform raw Docker data to common format
    function transformResourceData(resources, resourceType) {
        switch (resourceType) {
            case 'images':
                return resources.map(function(image) {
                    return {
                        id: image.ID,
                        repository: image.Repository,
                        tag: image.Tag,
                        size: image.Size,
                        created: image.CreatedAt,
                        inUse: false
                    };
                });
            case 'networks':
                return resources.map(function(network) {
                    return {
                        id: network.ID,
                        name: network.Name,
                        driver: network.Driver,
                        scope: network.Scope,
                        created: network.CreatedAt,
                        containers: []
                    };
                });
            case 'volumes':
                return resources.map(function(volume) {
                    return {
                        id: volume.Name,
                        name: volume.Name,
                        driver: volume.Driver,
                        mountpoint: volume.Mountpoint || '',
                        size: 'Calculating...',
                        created: '',
                        containers: []
                    };
                });
            default:
                return resources;
        }
    }

    // Optimized batch loading of resource details using batchOperations (Priority 3)
    function loadResourceDetailsBatched(resources, resourceType, customLoader, renderCallback) {
        if (customLoader) {
            customLoader(resources);
            return;
        }

        switch (resourceType) {
            case 'images':
                loadImageUsageBatched(resources, renderCallback);
                break;
            case 'networks':
                loadNetworkContainersBatched(resources, renderCallback);
                break;
            case 'volumes':
                loadVolumeDetailsBatched(resources, renderCallback);
                break;
            default:
                app()[resourceType] = resources;
                renderCallback();
        }
    }

    // Batch load image usage information
    function loadImageUsageBatched(images, renderCallback) {
        // Get all container images in one command using batchOperations
        const tasks = [
            function() { 
                return utils().executeCommand(['docker', 'ps', '-a', '--format', '{{.Image}}'], 
                    { superuser: 'try', suppressError: true });
            },
            function() { 
                return utils().executeCommand(['docker', 'ps', '-a', '--filter', 'status=exited', '--filter', 'status=paused', '--format', '{{.Image}}'], 
                    { superuser: 'try', suppressError: true });
            }
        ];
        
        utils().batchOperations.processParallel(tasks, function(task) { return task(); }, 2)
            .then(function(results) {
                const runningImages = results[0].success ? results[0].data.split('\n').filter(function(line) { return line.trim(); }) : [];
                const stoppedImages = results[1].success ? results[1].data.split('\n').filter(function(line) { return line.trim(); }) : [];
                
                // Create a Set for O(1) lookup
                const usedImagesSet = new Set();
                runningImages.concat(stoppedImages).forEach(function(img) {
                    usedImagesSet.add(img);
                    // Also add without tag for :latest matching
                    const colonIndex = img.lastIndexOf(':');
                    if (colonIndex > -1) {
                        usedImagesSet.add(img.substring(0, colonIndex));
                    }
                });

                images.forEach(function(image) {
                    const imageName = image.repository + ':' + image.tag;
                    image.inUse = usedImagesSet.has(imageName) ||
                                usedImagesSet.has(image.repository) ||
                                usedImagesSet.has(image.id.substring(0, 12));
                });

                app().images = images;
                renderCallback();
            });
    }

    // Batch load network containers using batchOperations (Priority 3)
    function loadNetworkContainersBatched(networks, renderCallback) {
        if (networks.length === 0) {
            app().networks = networks;
            renderCallback();
            return;
        }

        // Use batch operations for parallel processing
        utils().batchOperations.processParallel(
            networks,
            function(network) {
                return utils().executeCommand([
                    'docker', 'network', 'inspect', network.id, 
                    '--format', '{{range $k, $v := .Containers}}{{$v.Name}}{{" "}}{{end}}'
                ], { superuser: 'try', suppressError: true })
                    .then(function(result) {
                        if (result.success) {
                            network.containers = result.data.trim().split(' ')
                                .filter(function(name) { return name; });
                        }
                        return network;
                    });
            },
            10 // Process 10 networks at a time
        ).then(function(networksWithContainers) {
            app().networks = networksWithContainers.filter(function(n) { return !n.error; });
            renderCallback();
        });
    }

    // Batch load volume details using batchOperations (Priority 3) - fully converted
    function loadVolumeDetailsBatched(volumes, renderCallback) {
        if (volumes.length === 0) {
            app().volumes = volumes;
            renderCallback();
            return;
        }

        const volumeNames = volumes.map(function(v) { return v.name; });
        
        // Use batchOperations for the two main commands
        const mainTasks = [
            // Get all volume details in one command
            function() {
                return utils().executeCommand(['docker', 'volume', 'inspect'].concat(volumeNames), 
                    { superuser: 'try', suppressError: true });
            },
            // Get all container mounts
            function() {
                return utils().executeCommand(['docker', 'ps', '-a', '--format', '{{.Names}}|{{.Mounts}}'], 
                    { superuser: 'try', suppressError: true });
            }
        ];
        
        utils().batchOperations.processParallel(mainTasks, function(task) { return task(); }, 2)
            .then(function(results) {
                // Process volume inspect data
                if (results[0].success) {
                    try {
                        const inspectData = JSON.parse(results[0].data);
                        inspectData.forEach(function(volData, index) {
                            if (volumes[index]) {
                                volumes[index].mountpoint = volData.Mountpoint || '';
                                volumes[index].created = volData.CreatedAt || '';
                            }
                        });
                    } catch (e) {
                        // Continue with what we have
                    }
                }

                // Process container mounts
                if (results[1].success) {
                    const mountData = results[1].data.trim().split('\n');
                    const volumeContainerMap = {};
                    
                    mountData.forEach(function(line) {
                        const parts = line.split('|');
                        if (parts.length >= 2) {
                            const containerName = parts[0];
                            const mounts = parts[1];
                            
                            volumes.forEach(function(volume) {
                                if (mounts.includes(volume.name)) {
                                    if (!volumeContainerMap[volume.name]) {
                                        volumeContainerMap[volume.name] = [];
                                    }
                                    volumeContainerMap[volume.name].push(containerName);
                                }
                            });
                        }
                    });
                    
                    volumes.forEach(function(volume) {
                        volume.containers = volumeContainerMap[volume.name] || [];
                    });
                }

                // Get sizes using batch operations
                const mountpoints = volumes
                    .filter(function(v) { return v.mountpoint; })
                    .map(function(v) { return v.mountpoint; });
                
                if (mountpoints.length > 0) {
                    // Split mountpoints into chunks of 20
                    const chunks = [];
                    for (let i = 0; i < mountpoints.length; i += 20) {
                        chunks.push(mountpoints.slice(i, i + 20));
                    }
                    
                    // Process chunks in parallel
                    utils().batchOperations.processParallel(
                        chunks,
                        function(batch) {
                            return utils().executeCommand(['du', '-sh'].concat(batch), 
                                { superuser: 'try', suppressError: true });
                        },
                        5 // Process 5 chunks at a time
                    ).then(function(sizeResults) {
                        // Combine all results
                        sizeResults.forEach(function(result) {
                            if (result.success) {
                                const lines = result.data.trim().split('\n');
                                lines.forEach(function(line) {
                                    const parts = line.split('\t');
                                    if (parts.length >= 2) {
                                        const size = parts[0];
                                        const path = parts[1];
                                        
                                        const volume = volumes.find(function(v) { 
                                            return v.mountpoint === path; 
                                        });
                                        if (volume) {
                                            volume.size = size;
                                        }
                                    }
                                });
                            }
                        });
                        
                        // Set N/A for volumes without size
                        volumes.forEach(function(volume) {
                            if (volume.size === 'Calculating...') {
                                volume.size = 'N/A';
                            }
                        });
                        
                        app().volumes = volumes;
                        renderCallback();
                    });
                } else {
                    volumes.forEach(function(volume) {
                        volume.size = 'N/A';
                    });
                    app().volumes = volumes;
                    renderCallback();
                }
            });
    }

    // Get default columns for resource type
    function getDefaultColumns(resourceType) {
        const actionColumn = {
            key: 'actions',
            label: 'Actions',
            className: 'actions-column',
            renderer: function(value, item) {
                return renderResourceActions(item, resourceType);
            }
        };

        switch (resourceType) {
            case 'images':
                return [
                    { key: 'repository', label: 'Repository' },
                    { key: 'tag', label: 'Tag' },
                    { key: 'size', label: 'Size' },
                    { key: 'created', label: 'Created' },
                    { 
                        key: 'status', 
                        label: 'Status',
                        renderer: function(value, item) {
                            const status = item.inUse ? 'in-use' : 'unused';
                            const text = item.inUse ? 'In Use' : 'Unused';
                            return '<span class="status-badge-small ' + status + '">' + text + '</span>';
                        }
                    },
                    actionColumn
                ];
            case 'networks':
                return [
                    { key: 'name', label: 'Network Name' },
                    { key: 'driver', label: 'Driver' },
                    { key: 'scope', label: 'Scope' },
                    { key: 'containers', label: 'Containers' },
                    { key: 'created', label: 'Created' },
                    actionColumn
                ];
            case 'volumes':
                return [
                    { key: 'name', label: 'Volume Name' },
                    { key: 'driver', label: 'Driver' },
                    { 
                        key: 'mountpoint', 
                        label: 'Mount Point',
                        className: 'mountpoint-cell',
                        renderer: function(value) {
                            return '<span title="' + utils().escapeHtml(value) + '">' + 
                                   utils().escapeHtml(value) + '</span>';
                        }
                    },
                    { key: 'size', label: 'Size' },
                    { key: 'containers', label: 'Used By' },
                    { key: 'created', label: 'Created' },
                    actionColumn
                ];
        }
    }

    // Get default search columns
    function getDefaultSearchColumns(resourceType) {
        switch (resourceType) {
            case 'images': return [0, 1]; // Repository, Tag
            case 'networks': return [0, 1, 2]; // Name, Driver, Scope
            case 'volumes': return [0, 1, 2]; // Name, Driver, Mountpoint
        }
    }

    // Get common validators
    function getCommonValidators(resourceType) {
        const validators = {};
        
        // Add name validator for networks and volumes
        if (resourceType === 'networks' || resourceType === 'volumes') {
            const nameField = resourceType === 'networks' ? 'network-name' : 'volume-name';
            validators[nameField] = function(value) {
                return utils().validators.resourceName(value, resourceType.slice(0, -1));
            };
        }
        
        return validators;
    }

    // Render resource actions using data attributes (Priority 3)
    function renderResourceActions(item, resourceType) {
        const isInUse = item.containers && item.containers.length > 0;
        const isDefault = ['bridge', 'host', 'none'].indexOf(item.name) !== -1;
        const dom = utils().dom;
        
        if (resourceType === 'images') {
            if (item.inUse) {
                return '<div class="table-action-buttons"><span class="table-action-btn" style="opacity: 0.5;">In use</span></div>';
            } else {
                const btn = dom.create('button', {
                    className: 'table-action-btn danger',
                    textContent: 'Remove',
                    dataset: {
                        action: 'removeImage',
                        id: item.id
                    }
                });
                return '<div class="table-action-buttons">' + btn.outerHTML + '</div>';
            }
        } else if (resourceType === 'networks') {
            if (isDefault) {
                return '<div class="table-action-buttons"><span class="table-action-btn" style="opacity: 0.5;">Default</span></div>';
            } else if (isInUse) {
                return '<div class="table-action-buttons"><span class="table-action-btn" style="opacity: 0.5;">In use</span></div>';
            } else {
                const btn = dom.create('button', {
                    className: 'table-action-btn danger',
                    textContent: 'Remove',
                    dataset: {
                        action: 'removeNetwork',
                        id: item.id,
                        name: item.name
                    }
                });
                return '<div class="table-action-buttons">' + btn.outerHTML + '</div>';
            }
        } else if (resourceType === 'volumes') {
            if (isInUse) {
                return '<div class="table-action-buttons"><span class="table-action-btn" style="opacity: 0.5;">In use</span></div>';
            } else {
                const btn = dom.create('button', {
                    className: 'table-action-btn danger',
                    textContent: 'Remove',
                    dataset: {
                        action: 'removeVolume',
                        name: item.name
                    }
                });
                return '<div class="table-action-buttons">' + btn.outerHTML + '</div>';
            }
        }
    }

    // Build create command using dockerCommands
    function buildCreateCommand(type, formData) {
        switch (type) {
            case 'image':
                return utils().dockerCommands.docker(['pull'], [formData['image-name']]).command;
            case 'network':
                return buildNetworkCreateCommand(formData);
            case 'volume':
                return buildVolumeCreateCommand(formData);
        }
    }

    // Build network create command
    function buildNetworkCreateCommand(formData) {
        const args = ['network', 'create'];
        args.push('--driver', formData['network-driver']);
        
        if (formData['network-internal']) args.push('--internal');
        if (formData['network-ipv6']) args.push('--ipv6');
        if (formData['network-subnet']) args.push('--subnet', formData['network-subnet']);
        if (formData['network-gateway']) args.push('--gateway', formData['network-gateway']);
        
        args.push(formData['network-name']);
        
        return utils().dockerCommands.docker(args, []).command;
    }

    // Build volume create command
    function buildVolumeCreateCommand(formData) {
        const args = ['volume', 'create'];
        args.push('--driver', formData['volume-driver']);
        
        // Parse driver options
        const driverOptions = parseKeyValueOptions(formData['volume-driver-opts'], '--opt');
        driverOptions.forEach(function(opt) {
            args.push(opt.name, opt.value);
        });
        
        // Parse labels
        const labelOptions = parseKeyValueOptions(formData['volume-labels'], '--label');
        labelOptions.forEach(function(label) {
            args.push(label.name, label.value);
        });
        
        args.push(formData['volume-name']);
        
        return utils().dockerCommands.docker(args, []).command;
    }

    // Handle resource in use errors
    function handleResourceInUseError(error, resourceType) {
        if (resourceType === 'images') {
            if (error.includes('is being used')) {
                return 'Cannot remove: Image is being used by a container';
            } else if (error.includes('has dependent child images')) {
                return 'Cannot remove: Other images depend on this one';
            }
        }
        
        return utils().parseDockerError(error);
    }

    // Get prune configuration
    function getPruneConfig(resourceType) {
        const base = {
            title: 'Prune ' + resourceType.charAt(0).toUpperCase() + resourceType.slice(1),
            command: utils().dockerCommands.resource(resourceType.slice(0, -1), 'prune', ['-f']).command
        };
        
        switch (resourceType) {
            case 'images':
                base.message = 'Remove all unused images? This will free up disk space but may require re-downloading images later.';
                base.command.push('-a'); // Remove all unused, not just dangling
                break;
            case 'networks':
                base.message = 'Remove all unused networks? This will remove all networks not used by any containers.';
                break;
            case 'volumes':
                base.message = 'Remove all unused volumes? This will permanently delete all data in unused volumes.';
                break;
            default:
                base.message = 'Remove all unused ' + resourceType + '? This will free up disk space.';
        }
        
        return base;
    }

    // Parse space freed from prune output
    function parseSpaceFreed(output) {
        if (!output) return '';
        const match = output.match(/Total reclaimed space: (.+)/);
        return match ? ' (freed ' + match[1] + ')' : '';
    }

    // Helper function for common container list rendering
    function renderContainerList(containers) {
        const utils = window.DockerManager.utils;
        const dom = utils.dom;
        
        if (containers && containers.length > 0) {
            const count = dom.create('span', {
                className: 'container-count',
                textContent: containers.length + ' container' + (containers.length > 1 ? 's' : '')
            });
            
            const list = dom.create('div', { className: 'container-list-inline' });
            containers.forEach(function(container) {
                list.appendChild(dom.create('span', {
                    className: 'container-name-inline',
                    textContent: container
                }));
            });
            
            const wrapper = dom.create('div');
            wrapper.appendChild(count);
            wrapper.appendChild(list);
            return wrapper.innerHTML;
        } else {
            return '<span class="no-containers">Not in use</span>';
        }
    }

    // Helper function for parsing key=value format options
    function parseKeyValueOptions(text, optionName) {
        const options = [];
        if (!text) return options;
        
        const lines = text.split('\n');
        lines.forEach(function(line) {
            line = line.trim();
            if (line && !line.startsWith('#')) {
                options.push({ name: optionName, value: line });
            }
        });
        
        return options;
    }

    // Export public interface
    window.DockerManager.resources = {
        createResourceManager: createResourceManager,
        renderContainerList: renderContainerList,
        parseKeyValueOptions: parseKeyValueOptions,
        resourceActions: resourceActions
    };

})();
