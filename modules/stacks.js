// Docker Manager - Stack Management Module (Optimized)
(function() {
    'use strict';

    // Dependencies - get them when needed
    function getApp() { return window.DockerManager.app; }
    function getUtils() { return window.DockerManager.utils; }
    function getConfig() { return window.DockerManager.config; }
    function getTable() { return window.DockerManager.table; }
    function getModals() { return window.DockerManager.modals; }

    // View modal state
    let viewModal = {
        stackName: null,
        activeTab: 'overview',
        refreshInterval: null,
        logsRefreshInterval: null
    };

    // Track active operations to prevent double-clicks
    const activeOperations = new Set();

    // File operations utility
    const fileOps = {
        composeVariants: ['docker-compose.yaml', 'docker-compose.yml', 'compose.yaml', 'compose.yml'],
        
        read: function(stackName, type) {
            const app = getApp();
            const utils = getUtils();
            
            if (type === 'compose') {
                const tryVariant = (index) => {
                    if (index >= this.composeVariants.length) {
                        return { success: false, error: 'No compose file found' };
                    }
                    const filePath = app.stacksPath + '/' + stackName + '/' + this.composeVariants[index];
                    return utils.executeCommand(['cat', filePath], { superuser: 'try', suppressError: true })
                        .then(result => result.success ? result : tryVariant(index + 1));
                };
                return tryVariant(0);
            } else {
                const filePath = app.stacksPath + '/' + stackName + '/.env';
                return utils.executeCommand(['cat', filePath], { superuser: 'try', suppressError: true });
            }
        },
        
        write: function(stackName, type, content) {
            const app = getApp();
            const utils = getUtils();
            const stackDir = app.stacksPath + '/' + stackName;
            const filename = type === 'compose' ? '/docker-compose.yaml' : '/.env';
            const filePath = stackDir + filename;
            
            if (type === 'env' && (!content || !content.trim())) {
                return utils.executeCommand(['rm', '-f', filePath], { superuser: 'require', suppressError: true });
            }
            
            const writeFile = () => {
                if (typeof cockpit !== 'undefined' && typeof cockpit.file === 'function') {
                    const file = cockpit.file(filePath, { superuser: 'require' });
                    return file.replace(content)
                        .then(() => ({ success: true }))
                        .catch(() => this.writeViaCommand(filePath, content));
                }
                return this.writeViaCommand(filePath, content);
            };
            
            if (type === 'compose') {
                return utils.executeCommand(['mkdir', '-p', stackDir], { superuser: 'require' })
                    .then(result => {
                        if (!result.success) throw new Error('Failed to create stack directory');
                        return writeFile();
                    });
            }
            return writeFile();
        },
        
        writeViaCommand: function(filePath, content) {
            const utils = getUtils();
            const tempFile = '/tmp/docker-compose-' + Date.now() + '.yaml';
            const encodedContent = btoa(unescape(encodeURIComponent(content)));
            const writeCommand = 'echo "' + encodedContent + '" | base64 -d > "' + tempFile + '" && mv "' + tempFile + '" "' + filePath + '"';
            return utils.executeCommand(['sh', '-c', writeCommand], { superuser: 'require' });
        }
    };

    // Container utilities
    const containerUtils = {
        getContainers: function(stackName) {
            const utils = getUtils();
            const projectName = stackName.toLowerCase().replace(/[^a-z0-9]/g, '');
            
            const queries = [
                ['docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=' + projectName, '--format', '{{.Names}}\t{{.State}}\t{{.Status}}'],
                ['docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=' + stackName, '--format', '{{.Names}}\t{{.State}}\t{{.Status}}'],
                ['sh', '-c', 'docker ps -a --format "{{.Names}}\t{{.State}}\t{{.Status}}" | grep -E "^' + stackName + '[-_]" || true']
            ];
            
            return utils.batchOperations.processSequentially(queries, query => 
                utils.executeCommand(query, { superuser: 'try', suppressError: true })
            ).then(results => {
                for (let i = 0; i < results.length; i++) {
                    if (results[i].success && results[i].data && results[i].data.trim()) {
                        return results[i];
                    }
                }
                return { success: false, data: '' };
            });
        },
        
        parseContainers: function(data) {
            if (!data || !data.trim()) return [];
            return data.trim().split('\n').map(line => {
                const parts = line.split('\t');
                if (parts.length >= 3) {
                    return {
                        name: parts[0],
                        state: parts[1].toLowerCase(),
                        status: parts[2]
                    };
                }
                return null;
            }).filter(c => c !== null);
        },
        
        getUptime: function(status) {
            if (!status || typeof status !== 'string') return 'N/A';
            if (status.toLowerCase().startsWith('up ')) return status.substring(3);
            if (status.toLowerCase().includes('exited')) return 'Stopped';
            return 'N/A';
        },
        
        getStackUptime: function(containers) {
            if (!containers || containers.length === 0) return 'N/A';
            const running = containers.filter(c => c.state === 'running');
            if (running.length === 0) return 'Stopped';
            return this.getUptime(running[0].status);
        }
    };

    // Parse utilities
    const parseUtils = {
        ports: function(content) {
            if (!content) return [];
            const ports = [];
            const lines = content.split('\n');
            let inPorts = false, currentIndent = 0;
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                
                if (trimmed === 'ports:') {
                    inPorts = true;
                    currentIndent = line.length - trimmed.length;
                    continue;
                }
                
                if (inPorts) {
                    const indent = line.length - line.trimStart().length;
                    if (trimmed && !trimmed.startsWith('-') && indent <= currentIndent) {
                        inPorts = false;
                        continue;
                    }
                    
                    if (trimmed.startsWith('-')) {
                        const portStr = trimmed.substring(1).trim().replace(/['"]/g, '');
                        const portMatch = portStr.match(/^(\d+):(\d+)(?:\/\w+)?$/);
                        if (portMatch) {
                            ports.push({
                                host: portMatch[1],
                                container: portMatch[2],
                                display: portMatch[1] + ':' + portMatch[2]
                            });
                        }
                    }
                }
            }
            return ports;
        },
        
        images: function(content) {
            if (!content) return [];
            const images = [];
            const lines = content.split('\n');
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                if (trimmed.startsWith('image:')) {
                    const imageStr = trimmed.substring(6).trim().replace(/['"]/g, '');
                    if (imageStr) images.push(imageStr);
                }
            }
            return images;
        }
    };

    // Enhanced stack action factory with streaming support
    const createStackAction = (actionType, config) => {
        return function(stackName) {
            const utils = getUtils();
            const dom = utils.dom;
            
            // Check if operation is already in progress
            const operationKey = `${actionType}-${stackName}`;
            if (activeOperations.has(operationKey)) {
                utils.showNotification('Operation already in progress', 'warning');
                return;
            }
            
            // Find and disable the button immediately
            const button = findActionButton(actionType, stackName);
            if (button) {
                // Store original state
                button.dataset.originalText = button.textContent;
                button.dataset.originalClass = button.className;
                
                // Set loading state
                dom.setLoading(button, true, config.loadingText || 'Processing...');
                button.classList.remove('danger', 'warning', 'success', 'info');
                button.classList.add('secondary');
            }
            
            activeOperations.add(operationKey);
            
            const performAction = () => {
                // Show initial notification
                utils.showProgressNotification(config.message.replace('{name}', stackName), 'info');
                
                // Use streaming for operations that may take time
                if (config.streaming !== false && (actionType === 'start' || actionType === 'create')) {
                    return performStreamingAction(stackName, config, button, operationKey);
                } else {
                    return performStandardAction(stackName, config, button, operationKey);
                }
            };
            
            if (config.confirm) {
                const modals = getModals();
                modals.confirm(config.confirm.replace('{name}', stackName), {
                    title: config.confirmTitle,
                    confirmLabel: config.confirmLabel || 'Yes'
                }).then(confirmed => {
                    if (confirmed) {
                        performAction();
                    } else {
                        // Reset button state
                        if (button) {
                            dom.setLoading(button, false);
                            button.className = button.dataset.originalClass;
                            delete button.dataset.originalText;
                            delete button.dataset.originalClass;
                        }
                        activeOperations.delete(operationKey);
                    }
                });
            } else {
                performAction();
            }
        };
    };

    // Find action button by type and stack name
    function findActionButton(actionType, stackName) {
        const actionMap = {
            'start': 'startStack',
            'stop': 'stopStack',
            'restart': 'restartStack',
            'update': 'updateStack',
            'remove': 'removeStack'
        };
        
        const action = actionMap[actionType];
        if (!action) return null;
        
        return document.querySelector(`[data-action="${action}"][data-name="${stackName}"]`);
    }

    // Perform standard (non-streaming) action - FIXED
    function performStandardAction(stackName, config, button, operationKey) {
        const utils = getUtils();
        const dom = utils.dom;
        
        // Use runDockerCompose directly since it handles the command building internally
        return utils.runDockerCompose(stackName, config.command)
            .then(result => {
                if (result.success) {
                    utils.showNotification(config.successMessage.replace('{name}', stackName), 'success');
                    if (config.onSuccess) config.onSuccess();
                    setTimeout(loadStacks, config.delay || 1000);
                } else {
                    utils.showNotification('Failed: ' + utils.parseDockerError(result.error), 'error');
                }
            })
            .finally(() => {
                // Reset button state
                if (button) {
                    dom.setLoading(button, false);
                    button.className = button.dataset.originalClass;
                    delete button.dataset.originalText;
                    delete button.dataset.originalClass;
                }
                activeOperations.delete(operationKey);
                utils.hideProgressNotification();
            });
    }

    // Perform streaming action with real-time progress - FIXED
    function performStreamingAction(stackName, config, button, operationKey) {
        const utils = getUtils();
        const dom = utils.dom;
        
        let lastProgressUpdate = Date.now();
        const progressUpdateInterval = 500; // Update UI at most every 500ms
        
        return utils.runDockerComposeStreaming(stackName, config.command, {
            onProgress: function(progress) {
                const now = Date.now();
                if (now - lastProgressUpdate > progressUpdateInterval) {
                    lastProgressUpdate = now;
                    
                    // Update notification based on progress type
                    switch (progress.type) {
                        case 'image-pull':
                            utils.showProgressNotification('Pulling image: ' + progress.message, 'info');
                            break;
                        case 'download-progress':
                            utils.showProgressNotification('Downloading: ' + progress.message, 'info');
                            break;
                        case 'container-operation':
                            utils.showProgressNotification(progress.message, 'info');
                            break;
                        case 'network-operation':
                        case 'volume-operation':
                            utils.showProgressNotification(progress.message, 'info');
                            break;
                        default:
                            // Only show non-empty status messages
                            if (progress.message && progress.message.trim()) {
                                utils.showProgressNotification(progress.message, 'info');
                            }
                    }
                }
            },
            onError: function(error) {
                utils.showNotification('Error: ' + utils.parseDockerError(error), 'error');
            }
        }).then(result => {
            if (result.success) {
                utils.showNotification(config.successMessage.replace('{name}', stackName), 'success');
                if (config.onSuccess) config.onSuccess();
                setTimeout(loadStacks, config.delay || 1000);
            } else {
                utils.showNotification('Failed: ' + utils.parseDockerError(result.error), 'error');
            }
        }).finally(() => {
            // Reset button state
            if (button) {
                dom.setLoading(button, false);
                button.className = button.dataset.originalClass;
                delete button.dataset.originalText;
                delete button.dataset.originalClass;
            }
            activeOperations.delete(operationKey);
            utils.hideProgressNotification();
        });
    }

    // Initialize table configuration
    function initializeTable() {
        const table = getTable();
        const utils = getUtils();
        const dom = utils.dom;
        
        table.registerTable('stacks-table', {
            columns: [
                { 
                    key: 'name', 
                    label: 'Stack Name',
                    renderer: function(value, item) {
                        let html = '<strong>' + utils.escapeHtml(value) + '</strong>';
                        if (item.hasError) html += '<span class="error-indicator" title="Configuration has errors">⚠️</span>';
                        if (getApp().stackUpdates[value]) html += '<span class="update-indicator" title="Updates available">🔄</span>';
                        return html;
                    }
                },
                { key: 'uptime', label: 'Uptime', sortTransform: getUtils().parseTime },
                { 
                    key: 'status', 
                    label: 'Status',
                    renderer: function(value) {
                        const statusText = value === 'error' ? 'Error' : value.charAt(0).toUpperCase() + value.slice(1);
                        return '<span class="status-badge-small ' + value + '">' + statusText + '</span>';
                    }
                },
                {
                    key: 'actions',
                    label: 'Actions',
                    className: 'actions-column',
                    renderer: function(value, item) {
                        return renderStackActions(item);
                    }
                }
            ],
            searchColumns: [0],
            emptyMessage: 'No stacks found. Click "Add stack" to create your first stack.',
            defaultSort: { column: 0, order: 'asc' }
        });
    }

    // Initialize modal configurations
    function initializeModals() {
        const modals = getModals();
        const utils = getUtils();
        
        modals.registerModal('stack-modal', {
            title: function(data) {
                return data && data.mode === 'edit' ? 'Edit Stack: ' + data.stackName : 'Create New Stack';
            },
            size: 'large',
            fields: [
                {
                    name: 'stack-name',
                    label: 'Stack name',
                    type: 'text',
                    placeholder: 'e.g., webapp, database',
                    required: true,
                    helperText: 'Name for the stack directory. Use hyphens or underscores instead of spaces. Cannot be changed after creation.'
                },
                {
                    name: 'docker-compose-content',
                    label: 'Docker Compose Configuration',
                    type: 'textarea',
                    rows: 15,
                    required: true,
                    placeholder: 'services:\n  app:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n    restart: unless-stopped',
                    helperText: 'Docker Compose YAML configuration for your stack'
                },
                {
                    name: 'env-content',
                    label: 'Environment Variables (.env file)',
                    type: 'textarea',
                    rows: 10,
                    placeholder: '# Environment variables\n# Example:\n# DATABASE_PASSWORD=secret123\n# API_KEY=your-api-key',
                    helperText: 'Environment variables for your stack. These will be saved in a .env file and loaded automatically.'
                }
            ],
            validators: {
                'stack-name': function(value) {
                    return utils.validators.resourceName(value, 'Stack');
                },
                'docker-compose-content': function(value) {
                    if (!value) return 'Docker Compose configuration is required';
                    if (!value.includes('services:')) return 'Configuration must contain a "services:" section';
                    return null;
                }
            },
            onShow: function(data) {
                const nameInput = utils.getElement('stack-name');
                const contentTextarea = utils.getElement('docker-compose-content');
                const envTextarea = utils.getElement('env-content');
                
                if (data && data.mode === 'edit') {
                    nameInput.disabled = true;
                    nameInput.value = data.stackName;
                    
                    fileOps.read(data.stackName, 'compose').then(result => {
                        contentTextarea.value = result.success ? result.data : '# Failed to load configuration\n# Error: ' + (result.error || 'Unknown error');
                        if (result.success) utils.applyYamlHighlighting('docker-compose-content');
                        else utils.showNotification('Failed to load stack configuration', 'error');
                    });
                    
                    fileOps.read(data.stackName, 'env').then(result => {
                        envTextarea.value = result.success ? result.data : '';
                    });
                } else {
                    nameInput.disabled = false;
                    utils.applyYamlHighlighting('docker-compose-content');
                }
            },
            onHide: function() {
                utils.removeYamlHighlighting('docker-compose-content');
            },
            onSubmit: function(formData) {
                const mode = utils.getElement('stack-name').disabled ? 'edit' : 'create';
                return mode === 'create' ? handleCreateStack(formData) : handleSaveStack(formData['stack-name'], formData);
            },
            submitLabel: function(data) {
                return data && data.mode === 'edit' ? 'Save' : 'Create';
            }
        });

        setupViewStackModal();
    }

    // Setup view stack modal
    function setupViewStackModal() {
        const utils = getUtils();
        const dom = utils.dom;
        
        const closeBtn = utils.getElement('close-view-modal');
        if (closeBtn) closeBtn.addEventListener('click', hideViewStackModal);
        
        dom.queryAll('#view-modal-tabs .modal-tab').forEach(btn => {
            btn.addEventListener('click', () => switchViewModalTab(btn.dataset.tab));
        });
        
        const logsFilter = utils.getElement('logs-filter');
        if (logsFilter) logsFilter.addEventListener('input', loadStackLogs);
    }

    // View modal operations
    function showViewStackModal(stackName) {
        const utils = getUtils();
        const dom = utils.dom;
        const modal = utils.getElement('view-stack-modal');
        
        if (!modal) return;
        
        viewModal.stackName = stackName;
        viewModal.activeTab = 'overview';
        
        const titleElement = dom.query('#view-modal-title');
        if (titleElement) titleElement.textContent = 'Stack Details: ' + stackName;
        
        dom.queryAll('#view-modal-tabs .modal-tab').forEach(btn => {
            dom.toggleClass(btn, 'active', btn.dataset.tab === 'overview');
        });
        
        dom.queryAll('#view-stack-modal .tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        dom.addClass('view-overview-content', 'active');
        
        // Reset content
        const overviewContent = utils.getElement('view-overview-content');
        if (overviewContent) {
            overviewContent.innerHTML = '<div class="loading-message">Loading container statistics...</div>';
            delete overviewContent.dataset.loaded;
        }
        
        utils.getElement('view-compose-textarea').value = 'Loading...';
        utils.getElement('view-env-textarea').value = 'Loading...';
        utils.getElement('logs-filter').value = '';
        
        const logsContainer = utils.getElement('view-logs-container');
        if (logsContainer) {
            logsContainer.innerHTML = '<div class="loading-message">Loading logs...</div>';
            delete logsContainer.dataset.loaded;
        }
        
        modal.style.display = 'flex';
        modal.removeAttribute('aria-hidden');
        
        switchViewModalTab('overview');
    }

    function hideViewStackModal() {
        const modal = getUtils().getElement('view-stack-modal');
        if (!modal) return;
        
        if (viewModal.refreshInterval) clearInterval(viewModal.refreshInterval);
        if (viewModal.logsRefreshInterval) clearInterval(viewModal.logsRefreshInterval);
        viewModal.refreshInterval = null;
        viewModal.logsRefreshInterval = null;
        
        getUtils().removeYamlHighlighting('view-compose-textarea');
        
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        viewModal.stackName = null;
        viewModal.activeTab = 'overview';
    }

    function switchViewModalTab(tab) {
        const utils = getUtils();
        const dom = utils.dom;
        viewModal.activeTab = tab;
        
        dom.queryAll('#view-modal-tabs .modal-tab').forEach(btn => {
            dom.toggleClass(btn, 'active', btn.dataset.tab === tab);
        });
        
        dom.queryAll('#view-stack-modal .tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        dom.addClass('view-' + tab + '-content', 'active');
        
        if (viewModal.refreshInterval) clearInterval(viewModal.refreshInterval);
        if (viewModal.logsRefreshInterval) clearInterval(viewModal.logsRefreshInterval);
        viewModal.refreshInterval = null;
        viewModal.logsRefreshInterval = null;
        
        const loaders = {
            overview: { fn: loadStackOverview, interval: 2000 },
            compose: { fn: () => { loadComposeContent(); loadEnvContent(); }, interval: null },
            logs: { fn: loadStackLogs, interval: 3000, intervalKey: 'logsRefreshInterval' }
        };
        
        const loader = loaders[tab];
        if (loader) {
            loader.fn();
            if (loader.interval) {
                const key = loader.intervalKey || 'refreshInterval';
                viewModal[key] = setInterval(loader.fn, loader.interval);
            }
        }
    }

    // View modal content loaders
    function loadStackOverview() {
        const app = getApp();
        const utils = getUtils();
        const dom = utils.dom;
        const container = utils.getElement('view-overview-content');
        
        if (!container) return;
        
        if (!container.dataset.loaded) {
            container.innerHTML = '<div class="loading-message">Loading container statistics...</div>';
        }
        
        const stack = app.stacks.find(s => s.name === viewModal.stackName);
        if (!stack) {
            container.innerHTML = '<div class="error-message">Stack not found</div>';
            return;
        }
        
        containerUtils.getContainers(viewModal.stackName).then(result => {
            if (!result.success || !result.data.trim()) {
                container.innerHTML = '<div class="empty-message">No containers found for this stack</div>';
                return;
            }
            
            const containers = containerUtils.parseContainers(result.data);
            const containerNames = containers.map(c => c.name);
            
            if (containerNames.length === 0) {
                container.innerHTML = '<div class="empty-message">No containers found for this stack</div>';
                return;
            }
            
            return utils.batchOperations.processParallel(
                containerNames,
                name => utils.executeCommand(['docker', 'stats', '--no-stream', '--format', 'json', name], 
                    { superuser: 'try', suppressError: true }),
                5
            ).then(results => {
                const statsHtml = results.map(result => {
                    if (!result.success || !result.data.trim()) return '';
                    
                    try {
                        const stat = JSON.parse(result.data);
                        const containerInfo = containers.find(c => c.name === (stat.Name || stat.Container));
                        
                        return createStatCard(stat, containerInfo, stack);
                    } catch (e) {
                        return '';
                    }
                }).filter(html => html).join('');
                
                container.innerHTML = statsHtml ? '<div class="stats-grid">' + statsHtml + '</div>' : 
                    createSimpleContainerList(stack, containers);
                container.dataset.loaded = 'true';
            });
        }).catch(() => {
            if (!container.dataset.loaded) {
                container.innerHTML = '<div class="error-message">Failed to load container statistics</div>';
            }
        });
    }

    function createStatCard(stat, containerInfo, stack) {
        const cpuValue = parseFloat(stat.CPUPerc || '0');
        const memValue = parseFloat(stat.MemPerc || '0');
        const cpuClass = cpuValue > 80 ? 'high-usage' : cpuValue > 50 ? 'medium-usage' : '';
        const memClass = memValue > 80 ? 'high-usage' : memValue > 50 ? 'medium-usage' : '';
        
        let html = '<div class="stat-card"><h4>' + (stat.Name || stat.Container) + '</h4>';
        
        if (containerInfo) {
            html += '<div class="stat-row"><span class="stat-label">Status:</span><span class="stat-value">' + 
                    containerUtils.getUptime(containerInfo.status) + '</span></div>';
        }
        
        const stats = [
            { label: 'CPU:', value: stat.CPUPerc || '0%', className: cpuClass },
            { label: 'Memory:', value: (stat.MemUsage || '0B / 0B') + ' (' + (stat.MemPerc || '0%') + ')', className: memClass },
            { label: 'Network I/O:', value: stat.NetIO || '0B / 0B' },
            { label: 'Block I/O:', value: stat.BlockIO || '0B / 0B' },
            { label: 'PIDs:', value: stat.PIDs || '0' }
        ];
        
        stats.forEach(item => {
            html += '<div class="stat-row"><span class="stat-label">' + item.label + 
                    '</span><span class="stat-value' + (item.className ? ' ' + item.className : '') + '">' + 
                    item.value + '</span></div>';
        });
        
        if (stack.ports.length > 0) {
            html += '<div class="stat-row"><span class="stat-label">Ports:</span><span class="stat-value ports-inline">';
            stack.ports.forEach((port, i) => {
                if (i > 0) html += ' ';
                html += '<a href="http://localhost:' + port.host + '" target="_blank" class="port-link-inline" title="Open http://localhost:' + 
                        port.host + '">' + port.display + '</a>';
            });
            html += '</span></div>';
        }
        
        html += '</div>';
        return html;
    }

    function createSimpleContainerList(stack, containers) {
        let html = '<div class="stats-grid"><div class="stat-card"><h4>Containers</h4>';
        
        containers.forEach(container => {
            const statusClass = container.state === 'running' ? 'running' : 'stopped';
            html += '<div class="container-info-row"><span class="container-status-dot ' + statusClass + 
                    '"></span><span class="container-name">' + container.name + 
                    '</span><span class="container-uptime">' + containerUtils.getUptime(container.status) + '</span></div>';
        });
        
        html += '</div></div>';
        return html;
    }

    function loadComposeContent() {
        const textarea = getUtils().getElement('view-compose-textarea');
        if (!textarea) return;
        
        textarea.value = 'Loading...';
        fileOps.read(viewModal.stackName, 'compose').then(result => {
            textarea.value = result.success ? result.data : '# Failed to load configuration\n# Error: ' + (result.error || 'Unknown error');
            if (result.success) getUtils().applyYamlHighlighting('view-compose-textarea');
        });
    }

    function loadEnvContent() {
        const textarea = getUtils().getElement('view-env-textarea');
        if (!textarea) return;
        
        textarea.value = 'Loading...';
        fileOps.read(viewModal.stackName, 'env').then(result => {
            textarea.value = result.success && result.data.trim() ? result.data : '# No environment variables file found';
        });
    }

    function loadStackLogs() {
        const utils = getUtils();
        const container = utils.getElement('view-logs-container');
        const filter = utils.getElement('logs-filter').value.toLowerCase();
        
        if (!container) return;
        
        let wasAtBottom = false;
        if (container.dataset.loaded) {
            const threshold = 50;
            wasAtBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < threshold;
        }
        
        containerUtils.getContainers(viewModal.stackName).then(result => {
            if (!result.success || !result.data.trim()) {
                container.innerHTML = '<div class="empty-message">No containers found for this stack</div>';
                container.dataset.loaded = 'true';
                return;
            }
            
            const containers = containerUtils.parseContainers(result.data);
            const containerNames = containers.map(c => c.name);
            
            if (containerNames.length === 0) {
                container.innerHTML = '<div class="empty-message">No containers found for this stack</div>';
                container.dataset.loaded = 'true';
                return;
            }
            
            return utils.batchOperations.processParallel(
                containerNames,
                name => utils.executeCommand(['docker', 'logs', '--tail', '200', '--timestamps', name], 
                    { superuser: 'try', suppressError: true })
                    .then(result => ({ name: name, logs: result.data || result.error || 'No logs available' })),
                5
            );
        }).then(results => {
            if (!results || results.length === 0) return;
            
            let logsHtml = '';
            let hasContent = false;
            
            results.forEach(containerLogs => {
                let logs = containerLogs.logs;
                
                if (filter) {
                    const lines = logs.split('\n');
                    logs = lines.filter(line => line.toLowerCase().includes(filter)).join('\n');
                }
                
                if (logs.trim()) {
                    hasContent = true;
                    logsHtml += '<div class="log-section"><h5>' + containerLogs.name + 
                               '</h5><div class="log-content-wrapper"><pre class="log-content">' + 
                               utils.escapeHtml(logs) + '</pre></div></div>';
                }
            });
            
            container.innerHTML = hasContent ? logsHtml : '<div class="empty-message">No logs match the filter criteria</div>';
            
            if (!container.dataset.loaded || wasAtBottom) {
                container.querySelectorAll('.log-content-wrapper').forEach(wrapper => {
                    wrapper.scrollTop = wrapper.scrollHeight;
                });
            }
            
            container.dataset.loaded = 'true';
        }).catch(() => {
            container.innerHTML = '<div class="error-message">Failed to load logs</div>';
            container.dataset.loaded = 'true';
        });
    }

    // Render stack actions
    function renderStackActions(stack) {
        const actions = [];
        
        if (stack.status === 'running' || stack.status === 'partial') {
            actions.push({ label: 'View', className: 'primary', action: 'viewStack', data: { name: stack.name } });
            if (getApp().stackUpdates[stack.name]) {
                actions.push({ label: 'Update', className: 'info', action: 'updateStack', data: { name: stack.name } });
            }
            actions.push(
                { label: 'Restart', className: 'warning', action: 'restartStack', data: { name: stack.name } },
                { label: 'Stop', className: 'danger', action: 'stopStack', data: { name: stack.name } }
            );
        } else {
            actions.push({ label: 'Edit', className: 'primary', action: 'editStack', data: { name: stack.name } });
            if (!stack.hasError) {
                actions.push({ label: 'Start', className: 'success', action: 'startStack', data: { name: stack.name } });
            }
            actions.push({ label: 'Remove', className: 'danger', action: 'removeStack', data: { name: stack.name } });
        }
        
        const buttonsHtml = actions.map(action => {
            const dataAttrs = Object.entries(action.data)
                .map(([key, value]) => `data-${key}="${getUtils().escapeHtml(value)}"`)
                .join(' ');
            return `<button class="table-action-btn ${action.className}" data-action="${action.action}" ${dataAttrs}>${action.label}</button>`;
        }).join('');
        
        return '<div class="table-action-buttons">' + buttonsHtml + '</div>';
    }

    // Stack operations with enhanced progress
    function handleCreateStack(formData) {
        const app = getApp();
        const utils = getUtils();
        const stackName = formData['stack-name'];
        const content = formData['docker-compose-content'];
        const envContent = formData['env-content'];
        
        utils.showProgressNotification('Creating stack "' + stackName + '"...', 'info');
        
        const stackDir = app.stacksPath + '/' + stackName;
        
        return utils.errorHandler.handleAsync(
            utils.executeCommand(['test', '-d', stackDir], { superuser: 'try', suppressError: true }),
            'stack-create',
            () => { throw { field: 'stack-name', message: 'Stack "' + stackName + '" already exists' }; },
            () => createStackSequence(stackName, content, envContent)
        );
    }

    function createStackSequence(stackName, content, envContent) {
        const utils = getUtils();
        
        const tasks = [
            () => {
                utils.showProgressNotification('Writing configuration files...', 'info');
                return fileOps.write(stackName, 'compose', content);
            },
            () => envContent ? fileOps.write(stackName, 'env', envContent) : { success: true },
            () => {
                utils.showProgressNotification('Creating build contexts...', 'info');
                return createBuildContexts(stackName, content);
            },
            () => {
                utils.showProgressNotification('Validating configuration...', 'info');
                return utils.runDockerCompose(stackName, ['config', '--quiet'], { suppressError: true });
            }
        ];
        
        return utils.batchOperations.processSequentially(tasks, task => task()).then(results => {
            const lastResult = results[results.length - 1];
            const message = lastResult.success ? 
                'Stack "' + stackName + '" created successfully. Use the Start button to launch it.' :
                'Stack "' + stackName + '" created. Check configuration before starting.';
            utils.showNotification(message, lastResult.success ? 'success' : 'warning');
            loadStacks();
            return true;
        }).finally(() => {
            utils.hideProgressNotification();
        });
    }

    function handleSaveStack(stackName, formData) {
        const utils = getUtils();
        const content = formData['docker-compose-content'];
        const envContent = formData['env-content'];
        
        utils.showProgressNotification('Saving stack "' + stackName + '"...', 'info');
        
        const tasks = [
            () => fileOps.write(stackName, 'compose', content),
            () => fileOps.write(stackName, 'env', envContent),
            () => createBuildContexts(stackName, content),
            () => utils.runDockerCompose(stackName, ['config', '--quiet'], { suppressError: true })
        ];
        
        return utils.batchOperations.processSequentially(tasks, task => task()).then(results => {
            const lastResult = results[results.length - 1];
            const message = lastResult.success ? 
                'Stack "' + stackName + '" saved successfully' :
                'Stack "' + stackName + '" saved with warnings. Check configuration.';
            utils.showNotification(message, lastResult.success ? 'success' : 'warning');
            loadStacks();
            return true;
        }).finally(() => {
            utils.hideProgressNotification();
        });
    }

    function createBuildContexts(stackName, content) {
        const app = getApp();
        const utils = getUtils();
        const promises = [];
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            
            if (trimmed.startsWith('build:')) {
                let buildPath = trimmed.substring(6).trim().replace(/['"]/g, '');
                if (buildPath.startsWith('./')) buildPath = buildPath.substring(2);
                
                if (buildPath && !buildPath.startsWith('/')) {
                    const fullPath = app.stacksPath + '/' + stackName + '/' + buildPath;
                    
                    promises.push(
                        utils.executeCommand(['mkdir', '-p', fullPath], { superuser: 'require' })
                            .then(() => utils.executeCommand(['test', '-f', fullPath + '/Dockerfile'], 
                                { superuser: 'try', suppressError: true }))
                            .then(testResult => {
                                if (!testResult.success) {
                                    const dockerfileContent = '# Auto-generated Dockerfile\nFROM nginx:alpine\n\n' +
                                        '# Add your custom configuration here\n# COPY ./config /etc/nginx/conf.d/\n' +
                                        '# COPY ./html /usr/share/nginx/html/\n\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]\n';
                                    return fileOps.writeViaCommand(fullPath + '/Dockerfile', dockerfileContent);
                                }
                                return { success: true };
                            })
                    );
                }
            }
        }
        
        return Promise.all(promises);
    }

    // Update checking
    const updateChecker = {
        checkImage: function(image) {
            const utils = getUtils();
            
            return utils.batchOperations.processParallel([
                () => utils.executeCommand(['docker', 'image', 'inspect', image, '--format', '{{index .RepoDigests 0}}'], 
                    { superuser: 'try', suppressError: true }),
                () => utils.executeCommand(['docker', 'manifest', 'inspect', image], 
                    { superuser: 'try', suppressError: true })
            ], task => task(), 2).then(results => {
                const localDigest = results[0].success ? results[0].data.trim() : null;
                let remoteDigest = null;
                
                if (results[1].success) {
                    try {
                        const manifest = JSON.parse(results[1].data);
                        remoteDigest = manifest.config ? manifest.config.digest : null;
                    } catch (e) {}
                }
                
                return {
                    image: image,
                    hasUpdate: localDigest && remoteDigest ? localDigest !== remoteDigest : false,
                    localDigest: localDigest,
                    remoteDigest: remoteDigest
                };
            }).catch(error => ({ image: image, hasUpdate: false, error: error.message }));
        },
        
        checkAllStacks: function(showNotifications) {
            const app = getApp();
            const utils = getUtils();
            const config = getConfig();
            
            if (showNotifications) utils.showNotification('Checking for stack updates...', 'info');
            
            const updatePromises = app.stacks.map(stack => {
                if (!stack.content) return null;
                const images = parseUtils.images(stack.content);
                
                return utils.batchOperations.processParallel(images, this.checkImage.bind(this), 5)
                    .then(results => ({
                        stackName: stack.name,
                        hasUpdates: results.some(r => r.hasUpdate),
                        imageUpdates: results
                    }));
            }).filter(p => p !== null);
            
            return Promise.all(updatePromises).then(results => {
                const updateData = { lastCheck: Date.now(), updates: {} };
                let updatesFound = false;
                
                results.forEach(result => {
                    updateData.updates[result.stackName] = result;
                    app.stackUpdates[result.stackName] = result.hasUpdates;
                    if (result.hasUpdates) updatesFound = true;
                });
                
                return config.saveUpdateCheckData(updateData).then(() => {
                    if (showNotifications) {
                        const message = updatesFound ? 'Updates available for some stacks' : 'All stacks are up to date';
                        utils.showNotification(message, updatesFound ? 'info' : 'success');
                    }
                    
                    const lastCheckElement = utils.getElement('last-update-check');
                    if (lastCheckElement && utils.getElement('settings-modal').style.display === 'flex') {
                        const date = new Date(updateData.lastCheck);
                        lastCheckElement.textContent = 'Last checked: ' + date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                    }
                    
                    renderStacks();
                    return updateData;
                });
            }).catch(error => {
                if (showNotifications) utils.showNotification('Failed to check for updates: ' + error.message, 'error');
            });
        }
    };

    // Stack update execution with enhanced progress
    function updateStack(stackName) {
        const resources = window.DockerManager.resources;
        
        resources.resourceActions.execute({
            confirm: 'Update stack "' + stackName + '"? This will pull the latest images and recreate containers.',
            confirmTitle: 'Update Stack',
            confirmLabel: 'Update',
            onSuccess: () => safeUpdateStack(stackName).catch(() => {})
        });
    }

    function safeUpdateStack(stackName) {
        const app = getApp();
        const utils = getUtils();
        
        utils.showProgressNotification('Preparing to update stack "' + stackName + '"...', 'info');
        
        return utils.executeCommand(['mkdir', '-p', app.stacksPath + '/' + stackName], { superuser: 'require' })
            .then(() => {
                const backupPath = app.stacksPath + '/' + stackName + '/.backup.json';
                const content = JSON.stringify({ timestamp: Date.now() }, null, 2);
                return fileOps.writeViaCommand(backupPath, content);
            })
            .then(() => {
                const steps = [
                    { 
                        message: 'Pulling latest images for "' + stackName + '"...', 
                        command: ['pull'],
                        streaming: true
                    },
                    { 
                        message: 'Recreating containers for "' + stackName + '"...', 
                        command: ['up', '-d', '--force-recreate'],
                        streaming: true
                    },
                    { 
                        message: 'Cleaning old images...', 
                        command: ['image', 'prune', '-f'],
                        streaming: false
                    }
                ];
                
                return utils.batchOperations.processSequentially(steps, step => {
                    if (step.streaming) {
                        return utils.runDockerComposeStreaming(stackName, step.command, {
                            onProgress: function(progress) {
                                if (progress.type === 'image-pull' || progress.type === 'download-progress') {
                                    utils.showProgressNotification(progress.message, 'info');
                                } else if (progress.type === 'container-operation') {
                                    utils.showProgressNotification(progress.message, 'info');
                                }
                            }
                        });
                    } else {
                        utils.showProgressNotification(step.message, 'info');
                        return utils.runDockerCompose(stackName, step.command);
                    }
                }, 1000);
            })
            .then(() => {
                utils.showNotification('Stack "' + stackName + '" updated successfully', 'success');
                return updateChecker.checkAllStacks(false).then(() => loadStacks());
            })
            .catch(error => {
                utils.showNotification('Update failed: ' + error.message, 'error');
                throw error;
            })
            .finally(() => {
                utils.hideProgressNotification();
            });
    }

    function updateAllStacks() {
        const app = getApp();
        const utils = getUtils();
        const modals = getModals();
        const stacksToUpdate = Object.keys(app.stackUpdates).filter(name => app.stackUpdates[name]);
        
        if (stacksToUpdate.length === 0) {
            utils.showNotification('No stacks need updating', 'info');
            return;
        }
        
        modals.confirm(
            'Update ' + stacksToUpdate.length + ' stack' + (stacksToUpdate.length > 1 ? 's' : '') + 
            '? This will pull latest images and recreate containers.',
            { title: 'Update All Stacks', confirmLabel: 'Update All', cancelLabel: 'Cancel' }
        ).then(confirmed => {
            if (!confirmed) return;
            
            utils.showProgressNotification('Starting update of ' + stacksToUpdate.length + ' stacks...', 'info');
            
            let currentIndex = 0;
            utils.batchOperations.processSequentially(
                stacksToUpdate,
                stackName => {
                    utils.showProgressNotification('Updating stack ' + (++currentIndex) + ' of ' + stacksToUpdate.length + ': ' + stackName, 'info');
                    return safeUpdateStack(stackName).catch(error => {
                        utils.showNotification('Failed to update ' + stackName + ', continuing with next stack', 'warning');
                        return null;
                    });
                },
                2000
            ).then(() => {
                utils.showNotification('All stacks updated successfully', 'success');
                updateChecker.checkAllStacks(false);
            }).finally(() => {
                utils.hideProgressNotification();
            });
        });
    }

    // Stack loading and rendering
    function loadStacks() {
        const app = getApp();
        const utils = getUtils();
        const table = getTable();
        
        table.showLoading('stacks-table');
        
        utils.executeCommand(['mkdir', '-p', app.stacksPath], { superuser: 'try', suppressError: true })
            .then(() => utils.executeCommand(['find', app.stacksPath, '-maxdepth', '1', '-type', 'd', '-not', '-path', app.stacksPath], 
                { superuser: 'try', suppressError: true }))
            .then(result => {
                if (result.success && result.data.trim()) {
                    const stackPaths = result.data.split('\n').filter(path => path.trim());
                    
                    return utils.batchOperations.processParallel(
                        stackPaths,
                        path => {
                            const name = path.substring(app.stacksPath.length + 1);
                            
                            return utils.batchOperations.processSequentially(
                                fileOps.composeVariants,
                                file => utils.executeCommand(['test', '-f', path + '/' + file], 
                                    { superuser: 'try', suppressError: true })
                            ).then(results => {
                                if (results.some(r => r.success)) {
                                    return {
                                        name: name,
                                        status: 'unknown',
                                        content: null,
                                        ports: [],
                                        containers: [],
                                        hasError: false,
                                        uptime: 'N/A'
                                    };
                                }
                                return null;
                            });
                        },
                        10
                    );
                } else {
                    return [];
                }
            })
            .then(stacks => {
                app.stacks = stacks.filter(stack => stack !== null);
                
                if (app.stacks.length > 0) {
                    loadStackDetails();
                } else {
                    renderStacks();
                }
            })
            .catch(() => {
                app.stacks = [];
                table.showError('stacks-table', 'Failed to load stacks');
            });
    }

    function loadStackDetails() {
        const app = getApp();
        const utils = getUtils();
        
        if (app.stacks.length === 0) {
            renderStacks();
            return;
        }

        const stacksWithIndex = app.stacks.map((stack, index) => ({ stack: stack, index: index }));

        utils.batchOperations.processParallel(
            stacksWithIndex,
            item => loadStackInfo(item.stack, item.index),
            5
        ).then(() => renderStacks());
    }

    function loadStackInfo(stack, index) {
        const app = getApp();
        
        return fileOps.read(stack.name, 'compose').then(result => {
            if (!app.stacks[index]) throw new Error('Stack no longer exists at index ' + index);
            
            if (result.success) {
                app.stacks[index].content = result.data;
                app.stacks[index].ports = parseUtils.ports(result.data);
                app.stacks[index].hasError = false;
            } else {
                app.stacks[index].content = null;
                app.stacks[index].ports = [];
                app.stacks[index].hasError = true;
            }
            
            return containerUtils.getContainers(stack.name);
        }).then(result => {
            if (!app.stacks[index]) throw new Error('Stack no longer exists at index ' + index);
            
            if (result.success && result.data.trim()) {
                const containers = containerUtils.parseContainers(result.data);
                app.stacks[index].containers = containers;
                app.stacks[index].uptime = containerUtils.getStackUptime(containers);
                
                const runningCount = containers.filter(c => c.state === 'running').length;
                app.stacks[index].status = containers.length === 0 ? 'stopped' : 
                    runningCount === 0 ? 'stopped' : 
                    runningCount === containers.length ? 'running' : 'partial';
            } else {
                app.stacks[index].status = 'stopped';
                app.stacks[index].containers = [];
                app.stacks[index].uptime = 'Stopped';
            }
        }).catch(error => {
            if (app.stacks[index]) {
                app.stacks[index].status = 'error';
                app.stacks[index].containers = [];
                app.stacks[index].hasError = true;
                app.stacks[index].uptime = 'Error';
            }
            console.warn('Error loading stack info for ' + stack.name + ':', error);
        });
    }

    function renderStacks() {
        getTable().renderTable('stacks-table', getApp().stacks);
    }

    // Enhanced stack actions with streaming support
    const stackActions = {
        viewStack: stackName => showViewStackModal(stackName),
        editStack: stackName => getModals().showModal('stack-modal', { mode: 'edit', stackName: stackName }),
        startStack: createStackAction('start', {
            message: 'Starting stack "{name}"...',
            command: ['up', '-d'],
            successMessage: 'Stack "{name}" started successfully',
            loadingText: 'Starting...',
            streaming: true,
            delay: 2000
        }),
        stopStack: createStackAction('stop', {
            message: 'Stopping stack "{name}"...',
            command: ['down'],
            successMessage: 'Stack "{name}" stopped',
            loadingText: 'Stopping...',
            streaming: false,
            delay: 1000
        }),
        restartStack: createStackAction('restart', {
            message: 'Restarting stack "{name}"...',
            command: ['restart'],
            successMessage: 'Stack "{name}" restarted successfully',
            loadingText: 'Restarting...',
            streaming: false,
            delay: 2000
        }),
        updateStack: updateStack,
        removeStack: stackName => {
            const app = getApp();
            const utils = getUtils();
            const resources = window.DockerManager.resources;
            const dom = utils.dom;
            
            // Check if operation is already in progress
            const operationKey = `remove-${stackName}`;
            if (activeOperations.has(operationKey)) {
                utils.showNotification('Operation already in progress', 'warning');
                return;
            }
            
            resources.resourceActions.execute({
                confirm: 'Remove stack "' + stackName + '"? This will stop all containers and delete the stack configuration.',
                confirmTitle: 'Remove Stack',
                confirmLabel: 'Remove',
                onSuccess: () => {
                    activeOperations.add(operationKey);
                    
                    // Find and disable the button
                    const button = findActionButton('remove', stackName);
                    if (button) {
                        dom.setLoading(button, true, 'Removing...');
                    }
                    
                    utils.showProgressNotification('Removing stack "' + stackName + '"...', 'info');
                    
                    // Use streaming to show progress
                    utils.runDockerComposeStreaming(stackName, ['down', '-v'], {
                        onProgress: function(progress) {
                            if (progress.type === 'container-operation' && progress.message.includes('Stopping')) {
                                utils.showProgressNotification('Stopping containers...', 'info');
                            } else if (progress.message && progress.message.includes('Removing')) {
                                utils.showProgressNotification('Removing containers and volumes...', 'info');
                            }
                        }
                    }).then(() => {
                        utils.showProgressNotification('Deleting stack configuration...', 'info');
                        return utils.executeCommand(['rm', '-rf', app.stacksPath + '/' + stackName], { superuser: 'require' });
                    }).then(result => {
                        if (result.success) {
                            utils.showNotification('Stack "' + stackName + '" removed', 'success');
                            loadStacks();
                        } else {
                            utils.showNotification('Failed to remove stack: ' + utils.parseDockerError(result.error), 'error');
                        }
                    }).finally(() => {
                        activeOperations.delete(operationKey);
                        utils.hideProgressNotification();
                        
                        // Reset button if it still exists
                        if (button && button.parentNode) {
                            dom.setLoading(button, false);
                        }
                    });
                }
            });
        }
    };

    // Initialize on module load
    initializeTable();
    initializeModals();

    // Export public interface
    window.DockerManager.stacks = Object.assign({
        loadStacks: loadStacks,
        renderStacks: renderStacks,
        checkAllStacksForUpdates: updateChecker.checkAllStacks.bind(updateChecker),
        updateAllStacks: updateAllStacks,
        showStackModal: mode => getModals().showModal('stack-modal', { mode: mode }),
        hideStackModal: () => getModals().hideModal('stack-modal'),
        showViewStackModal: showViewStackModal,
        hideViewStackModal: hideViewStackModal,
        switchViewModalTab: switchViewModalTab,
        loadStackLogs: loadStackLogs
    }, stackActions);

})();
