// Docker Manager - Stack Management Module (Optimized)
(function() {
    'use strict';

    // Dependencies - lazy getters
    const deps = {
        get app() { return window.DockerManager.app; },
        get utils() { return window.DockerManager.utils; },
        get config() { return window.DockerManager.config; },
        get table() { return window.DockerManager.table; },
        get modals() { return window.DockerManager.modals; }
    };

    // Constants
    const COMPOSE_VARIANTS = ['docker-compose.yaml', 'docker-compose.yml', 'compose.yaml', 'compose.yml'];
    const UPDATE_INTERVAL = 2000;
    const LOGS_INTERVAL = 3000;
    
    // State
    const state = {
        activeOperations: new Set(),
        viewModal: {
            stackName: null,
            activeTab: 'overview',
            intervals: {}
        }
    };

    // File operations
    const fileOps = {
        async read(stackName, type) {
            const { app, utils } = deps;
            
            if (type === 'compose') {
                // Try each variant until one succeeds
                for (const variant of COMPOSE_VARIANTS) {
                    const filePath = `${app.stacksPath}/${stackName}/${variant}`;
                    const result = await utils.executeCommand(['cat', filePath], { 
                        superuser: 'try', 
                        suppressError: true 
                    });
                    if (result.success) return result;
                }
                return { success: false, error: 'No compose file found' };
            }
            
            const filePath = `${app.stacksPath}/${stackName}/.env`;
            return utils.executeCommand(['cat', filePath], { 
                superuser: 'try', 
                suppressError: true 
            });
        },
        
        async write(stackName, type, content) {
            const { app, utils } = deps;
            const stackDir = `${app.stacksPath}/${stackName}`;
            const filename = type === 'compose' ? '/docker-compose.yaml' : '/.env';
            const filePath = stackDir + filename;
            
            // Handle empty env file deletion
            if (type === 'env' && !content?.trim()) {
                return utils.executeCommand(['rm', '-f', filePath], { 
                    superuser: 'require', 
                    suppressError: true 
                });
            }
            
            // Write file
            const writeFile = async () => {
                const tempFile = `/tmp/docker-compose-${Date.now()}.yaml`;
                const encodedContent = btoa(unescape(encodeURIComponent(content)));
                const writeCommand = `echo "${encodedContent}" | base64 -d > "${tempFile}" && mv "${tempFile}" "${filePath}"`;
                return utils.executeCommand(['sh', '-c', writeCommand], { superuser: 'require' });
            };
            
            // Create directory for compose files
            if (type === 'compose') {
                const mkdirResult = await utils.executeCommand(['mkdir', '-p', stackDir], { 
                    superuser: 'require' 
                });
                if (!mkdirResult.success) {
                    return { success: false, error: 'Failed to create directory' };
                }
            }
            
            return writeFile();
        }
    };

    // Container utilities
    const containerUtils = {
        async getContainers(stackName) {
            const { utils } = deps;
            const projectName = stackName.toLowerCase().replace(/[^a-z0-9]/g, '');
            
            // Try Docker Compose labels first (most reliable)
            let result = await utils.executeCommand([
                'docker', 'ps', '-a', 
                '--filter', `label=com.docker.compose.project=${projectName}`,
                '--format', '{{.Names}}\t{{.State}}\t{{.Status}}'
            ], { superuser: 'try', suppressError: true });
            
            // If no results, try with original stack name
            if (!result.success || !result.data.trim()) {
                result = await utils.executeCommand([
                    'docker', 'ps', '-a',
                    '--filter', `label=com.docker.compose.project=${stackName}`,
                    '--format', '{{.Names}}\t{{.State}}\t{{.Status}}'
                ], { superuser: 'try', suppressError: true });
            }
            
            // Fallback to name pattern matching
            if (!result.success || !result.data.trim()) {
                result = await utils.executeCommand([
                    'sh', '-c',
                    `docker ps -a --format '{{.Names}}\t{{.State}}\t{{.Status}}' | grep -E '^${stackName}[-_]' || true`
                ], { superuser: 'try', suppressError: true });
            }
            
            return {
                success: result.success && Boolean(result.data.trim()),
                data: result.data || ''
            };
        },
        
        parseContainers(data) {
            if (!data?.trim()) return [];
            
            return data.trim().split('\n')
                .map(line => {
                    const [name, state, status] = line.split('\t');
                    return name ? { name, state: state?.toLowerCase(), status } : null;
                })
                .filter(Boolean);
        },
        
        getUptime(status) {
            if (!status || typeof status !== 'string') return 'N/A';
            const lowerStatus = status.toLowerCase();
            
            if (lowerStatus.startsWith('up ')) return status.substring(3);
            if (lowerStatus.includes('exited')) return 'Stopped';
            return 'N/A';
        },
        
        getStackUptime(containers) {
            if (!containers?.length) return 'N/A';
            
            const running = containers.find(c => c.state === 'running');
            return running ? this.getUptime(running.status) : 'Stopped';
        }
    };

    // Parse utilities
    const parseUtils = {
        ports(content) {
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
                        break;
                    }
                    
                    if (trimmed.startsWith('-')) {
                        const portStr = trimmed.substring(1).trim().replace(/['"]/g, '');
                        const match = portStr.match(/^(\d+):(\d+)(?:\/\w+)?$/);
                        if (match) {
                            ports.push({
                                host: match[1],
                                container: match[2],
                                display: `${match[1]}:${match[2]}`
                            });
                        }
                    }
                }
            }
            return ports;
        },
        
        images(content) {
            if (!content) return [];
            return content.split('\n')
                .map(line => {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('image:')) {
                        return trimmed.substring(6).trim().replace(/['"]/g, '');
                    }
                    return null;
                })
                .filter(Boolean);
        }
    };

    // Unified action handler
    const createStackAction = (actionType, config) => {
        return async function(stackName) {
            const { utils, modals } = deps;
            const operationKey = `${actionType}-${stackName}`;
            
            if (state.activeOperations.has(operationKey)) {
                utils.showNotification('Operation already in progress', 'warning');
                return;
            }
            
            state.activeOperations.add(operationKey);
            
            // Find and prepare button
            const button = document.querySelector(`[data-action="${actionType}Stack"][data-name="${stackName}"]`);
            const buttonState = button ? {
                element: button,
                originalText: button.textContent,
                originalClass: button.className
            } : null;
            
            if (button) {
                utils.dom.setLoading(button, true, config.loadingText || 'Processing...');
                button.className = 'table-action-btn secondary';
            }
            
            const performAction = async () => {
                try {
                    const notificationOptions = config.streaming ? { persist: true } : {};
                    utils.showNotification(config.message.replace('{name}', stackName), 'info', notificationOptions);
                    
                    let result;
                    if (config.streaming) {
                        result = await runStreamingCommand(stackName, config);
                    } else {
                        result = await utils.runDockerCompose(stackName, config.command);
                    }
                    
                    if (result.success) {
                        utils.showNotification(config.successMessage.replace('{name}', stackName), 'success');
                        if (config.onSuccess) config.onSuccess();
                        setTimeout(loadStacks, config.delay || 1000);
                    } else {
                        const errorMsg = utils.parseDockerError(result.error || result.data || 'Operation failed');
                        utils.showNotification(`Failed: ${errorMsg}`, 'error');
                    }
                } finally {
                    cleanup(operationKey, buttonState);
                }
            };
            
            if (config.confirm) {
                const confirmed = await modals.confirm(config.confirm.replace('{name}', stackName), {
                    title: config.confirmTitle,
                    confirmLabel: config.confirmLabel || 'Yes'
                });
                
                if (confirmed) {
                    await performAction();
                } else {
                    cleanup(operationKey, buttonState);
                }
            } else {
                await performAction();
            }
        };
    };

    function cleanup(operationKey, buttonState) {
        state.activeOperations.delete(operationKey);
        
        if (buttonState?.element) {
            deps.utils.dom.setLoading(buttonState.element, false);
            buttonState.element.className = buttonState.originalClass;
        }
        
        deps.utils.hideProgressNotification();
    }

    async function runStreamingCommand(stackName, config) {
        const { utils } = deps;
        let hasError = false;
        let lastError = '';
        
        return utils.runDockerComposeStreaming(stackName, config.command, {
            onProgress(progress) {
                if (progress.isError) {
                    hasError = true;
                    lastError = progress.message;
                    utils.showNotification(`Error: ${progress.message}`, 'error');
                } else if (progress.message?.trim()) {
                    utils.showNotification(progress.message, 'info', { persist: true });
                }
            },
            onError(error) {
                hasError = true;
                lastError = utils.parseDockerError(error);
                utils.showNotification(`Error: ${lastError}`, 'error');
            }
        }).then(result => {
            if (hasError) {
                result.success = false;
                result.error = lastError || result.error;
            }
            return result;
        });
    }

    // Stack actions
    const stackActions = {
        viewStack: name => showViewModal(name),
        editStack: name => deps.modals.showModal('stack-modal', { mode: 'edit', stackName: name }),
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
            delay: 1000
        }),
        restartStack: createStackAction('restart', {
            message: 'Restarting stack "{name}"...',
            command: ['restart'],
            successMessage: 'Stack "{name}" restarted successfully',
            loadingText: 'Restarting...',
            delay: 2000
        }),
        updateStack: name => updateStack(name),
        removeStack: name => removeStack(name)
    };

    // View modal management
    const viewModalConfig = {
        overview: {
            loader: loadStackOverview,
            interval: UPDATE_INTERVAL,
            contentId: 'view-overview-content',
            loadingMsg: 'Loading container statistics...'
        },
        compose: {
            loader: loadComposeFiles,
            contentId: 'view-compose-content'
        },
        logs: {
            loader: function() {
                // Call loadStackLogs directly
                loadStackLogs();
            },
            interval: LOGS_INTERVAL,
            contentId: 'view-logs-content',
            loadingMsg: 'Loading logs...'
        }
    };

    function showViewModal(stackName) {
        const { utils, app } = deps;
        const modal = utils.getElement('view-stack-modal');
        if (!modal) return;
        
        // Reset state and set stackName FIRST
        state.viewModal.stackName = stackName;
        state.viewModal.activeTab = 'overview';
        
        // Update title
        const title = modal.querySelector('#view-modal-title');
        if (title) title.textContent = `Stack Details: ${stackName}`;
        
        // Reset tabs
        modal.querySelectorAll('.modal-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === 'overview');
        });
        
        modal.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        
        const overviewPane = utils.getElement('view-overview-content');
        if (overviewPane) overviewPane.classList.add('active');
        
        // Clear any existing logs container to prevent stale loading messages
        const existingLogsContainer = modal.querySelector('#view-logs-container');
        if (existingLogsContainer) {
            existingLogsContainer.remove();
        }
        
        modal.style.display = 'flex';
        modal.removeAttribute('aria-hidden');
        
        // Load initial tab content
        switchViewModalTab('overview');
    }

    function hideViewModal() {
        const modal = deps.utils.getElement('view-stack-modal');
        if (!modal) return;
        
        // Clear all intervals
        Object.keys(state.viewModal.intervals).forEach(key => {
            if (state.viewModal.intervals[key]) {
                clearInterval(state.viewModal.intervals[key]);
                delete state.viewModal.intervals[key];
            }
        });
        
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        
        // Clear loaded state for logs container
        const logsContainer = document.querySelector('#view-logs-container');
        if (logsContainer) {
            delete logsContainer.dataset.loaded;
        }
        
        state.viewModal.stackName = null;
        state.viewModal.activeTab = 'overview';
    }

    function switchViewModalTab(tab) {
        const { utils } = deps;
        
        // Ensure config is initialized
        if (!viewModalConfig) {
            viewModalConfig = {
                overview: {
                    loader: loadStackOverview,
                    interval: UPDATE_INTERVAL,
                    contentId: 'view-overview-content',
                    loadingMsg: 'Loading container statistics...'
                },
                compose: {
                    loader: loadComposeFiles,
                    contentId: 'view-compose-content'
                },
                logs: {
                    loader: loadStackLogs,
                    interval: LOGS_INTERVAL,
                    contentId: 'view-logs-content'
                }
            };
        }
        
        // Clear existing intervals for this tab
        Object.keys(state.viewModal.intervals).forEach(key => {
            if (state.viewModal.intervals[key]) {
                clearInterval(state.viewModal.intervals[key]);
                delete state.viewModal.intervals[key];
            }
        });
        
        // Update UI
        document.querySelectorAll('#view-modal-tabs .modal-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        document.querySelectorAll('#view-stack-modal .tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        
        const activePane = utils.getElement(`view-${tab}-content`);
        if (activePane) activePane.classList.add('active');
        
        // Update active tab state
        state.viewModal.activeTab = tab;
        
        // Load content
        const config = viewModalConfig[tab];
        if (config) {
            if (config.loadingMsg) {
                const container = utils.getElement(config.contentId);
                if (container) {
                    container.innerHTML = `<div class="loading-message">${config.loadingMsg}</div>`;
                }
            }
            
            // Call loader function
            config.loader();
            
            // Set up interval if needed
            if (config.interval) {
                state.viewModal.intervals[tab] = setInterval(function() {
                    // Double-check modal is still open before running interval
                    const modal = utils.getElement('view-stack-modal');
                    if (modal && modal.style.display !== 'none' && state.viewModal.activeTab === tab) {
                        config.loader();
                    }
                }, config.interval);
            }
        }
    }

    // View modal content loaders
    async function loadStackOverview() {
        const { app, utils } = deps;
        const container = utils.getElement('view-overview-content');
        if (!container) return;
        
        const stack = app.stacks.find(s => s.name === state.viewModal.stackName);
        if (!stack) {
            container.innerHTML = '<div class="error-message">Stack not found</div>';
            return;
        }
        
        try {
            const result = await containerUtils.getContainers(state.viewModal.stackName);
            if (!result.success || !result.data.trim()) {
                container.innerHTML = '<div class="empty-message">No containers found for this stack</div>';
                return;
            }
            
            const containers = containerUtils.parseContainers(result.data);
            const stats = await loadContainerStats(containers);
            
            container.innerHTML = `<div class="stats-grid">${stats.map(stat => 
                createStatCard(stat, containers.find(c => c.name === stat.name), stack)
            ).join('')}</div>`;
            
        } catch (error) {
            if (!container.dataset.loaded) {
                container.innerHTML = '<div class="error-message">Failed to load container statistics</div>';
            }
        }
    }

    async function loadContainerStats(containers) {
        const { utils } = deps;
        const names = containers.map(c => c.name);
        
        const results = await Promise.all(
            names.map(name => 
                utils.executeCommand(['docker', 'stats', '--no-stream', '--format', 'json', name], {
                    superuser: 'try',
                    suppressError: true
                })
            )
        );
        
        return results
            .filter(r => r.success && r.data)
            .map(r => {
                try {
                    return JSON.parse(r.data);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    }

    function createStatCard(stat, containerInfo, stack) {
        const { utils } = deps;
        const name = stat.Name || stat.Container;
        const cpuValue = parseFloat(stat.CPUPerc || '0');
        const memValue = parseFloat(stat.MemPerc || '0');
        
        const elements = [
            `<div class="stat-card">`,
            `<h4>${utils.escapeHtml(name)}</h4>`
        ];
        
        if (containerInfo) {
            elements.push(
                `<div class="stat-row">`,
                `<span class="stat-label">Status:</span>`,
                `<span class="stat-value">${containerUtils.getUptime(containerInfo.status)}</span>`,
                `</div>`
            );
        }
        
        // Add stats
        const stats = [
            { label: 'CPU:', value: stat.CPUPerc || '0%', high: cpuValue > 80, medium: cpuValue > 50 },
            { label: 'Memory:', value: `${stat.MemUsage || '0B / 0B'} (${stat.MemPerc || '0%'})`, high: memValue > 80, medium: memValue > 50 },
            { label: 'Network I/O:', value: stat.NetIO || '0B / 0B' },
            { label: 'Block I/O:', value: stat.BlockIO || '0B / 0B' },
            { label: 'PIDs:', value: stat.PIDs || '0' }
        ];
        
        stats.forEach(({ label, value, high, medium }) => {
            const className = high ? 'high-usage' : medium ? 'medium-usage' : '';
            elements.push(
                `<div class="stat-row">`,
                `<span class="stat-label">${label}</span>`,
                `<span class="stat-value${className ? ' ' + className : ''}">${value}</span>`,
                `</div>`
            );
        });
        
        // Add ports
        if (stack.ports.length > 0) {
            elements.push(
                `<div class="stat-row">`,
                `<span class="stat-label">Ports:</span>`,
                `<span class="stat-value ports-inline">`,
                ...stack.ports.map((port, i) => 
                    `${i > 0 ? ' ' : ''}<a href="http://localhost:${port.host}" target="_blank" class="port-link-inline" title="Open http://localhost:${port.host}">${port.display}</a>`
                ),
                `</span></div>`
            );
        }
        
        elements.push('</div>');
        return elements.join('');
    }

    async function loadComposeFiles() {
        const [composeResult, envResult] = await Promise.all([
            fileOps.read(state.viewModal.stackName, 'compose'),
            fileOps.read(state.viewModal.stackName, 'env')
        ]);
        
        const composeTextarea = deps.utils.getElement('view-compose-textarea');
        const envTextarea = deps.utils.getElement('view-env-textarea');
        
        if (composeTextarea) {
            composeTextarea.value = composeResult.success 
                ? composeResult.data 
                : `# Failed to load configuration\n# Error: ${composeResult.error || 'Unknown error'}`;
        }
        
        if (envTextarea) {
            envTextarea.value = envResult.success && envResult.data.trim() 
                ? envResult.data 
                : '# No environment variables file found';
        }
    }

    function loadStackLogs() {
        const { utils } = deps;
        const stackName = state.viewModal.stackName;
        
        if (!stackName) return;
        
        // Direct approach - just find what we need
        const container = document.querySelector('#view-logs-container');
        
        if (!container) {
            // Try creating one in the logs content area
            const logsContent = document.querySelector('#view-logs-content');
            
            if (logsContent) {
                // Remove any existing loading message first
                const existingLoading = logsContent.querySelector('.loading-message');
                if (existingLoading) {
                    existingLoading.remove();
                }
                
                const newContainer = document.createElement('div');
                newContainer.className = 'logs-container';
                newContainer.id = 'view-logs-container';
                logsContent.appendChild(newContainer);
                
                // Load logs immediately
                loadLogsIntoContainer(newContainer, stackName);
            }
            return;
        }
        
        loadLogsIntoContainer(container, stackName);
    }
    
    function loadLogsIntoContainer(container, stackName) {
        const { utils } = deps;
        
        // Check if we should auto-scroll (user is at bottom)
        const wasAtBottom = isScrolledToBottom(container);
        
        // Get filter value
        const filterInput = utils.getElement('logs-filter');
        const filter = filterInput ? filterInput.value.toLowerCase() : '';
        
        // Only show loading state on first load
        if (!container.dataset.loaded) {
            container.innerHTML = '<div class="loading-message">Fetching logs...</div>';
        }
        
        // Get containers for this stack
        containerUtils.getContainers(stackName)
            .then(function(result) {
                if (!result.success || !result.data.trim()) {
                    throw new Error('No containers found');
                }
                
                const containers = containerUtils.parseContainers(result.data);
                if (containers.length === 0) {
                    throw new Error('No containers found');
                }
                
                // Fetch logs for each container
                return Promise.all(
                    containers.map(function(cont) {
                        return utils.executeCommand(
                            ['docker', 'logs', '--tail', '200', '--timestamps', cont.name],
                            { superuser: 'try', suppressError: true }
                        ).then(function(result) {
                            return {
                                name: cont.name,
                                logs: result.success ? result.data : 'No logs available'
                            };
                        });
                    })
                );
            })
            .then(function(containerLogs) {
                // Build HTML for logs
                let html = '';
                let hasLogs = false;
                
                containerLogs.forEach(function(item) {
                    let filteredLogs = item.logs;
                    
                    // Apply filter
                    if (filter && filteredLogs) {
                        const lines = filteredLogs.split('\n');
                        filteredLogs = lines
                            .filter(function(line) {
                                return line.toLowerCase().includes(filter);
                            })
                            .join('\n');
                    }
                    
                    if (filteredLogs && filteredLogs.trim()) {
                        hasLogs = true;
                        html += '<div class="log-section">' +
                                '<h5>' + utils.escapeHtml(item.name) + '</h5>' +
                                '<div class="log-content-wrapper">' +
                                '<pre class="log-content">' + utils.escapeHtml(filteredLogs) + '</pre>' +
                                '</div></div>';
                    }
                });
                
                if (hasLogs) {
                    container.innerHTML = html;
                    
                    // Auto-scroll to bottom if user was at bottom before
                    if (wasAtBottom || !container.dataset.loaded) {
                        setTimeout(function() {
                            // Scroll each log content wrapper to bottom
                            container.querySelectorAll('.log-content-wrapper').forEach(function(wrapper) {
                                wrapper.scrollTop = wrapper.scrollHeight;
                            });
                        }, 10);
                    }
                } else {
                    container.innerHTML = '<div class="empty-message">' +
                        (filter ? 'No logs match the filter criteria' : 'No logs available') +
                        '</div>';
                }
                
                container.dataset.loaded = 'true';
            })
            .catch(function(error) {
                container.innerHTML = '<div class="error-message">' + 
                    utils.escapeHtml(error.message || 'Failed to load logs') + 
                    '</div>';
                container.dataset.loaded = 'true';
            });
    }
    
    // Helper function to check if container is scrolled to bottom
    function isScrolledToBottom(container) {
        if (!container || !container.dataset.loaded) return true;
        
        // Check each log wrapper
        const wrappers = container.querySelectorAll('.log-content-wrapper');
        if (wrappers.length === 0) return true;
        
        // If any wrapper is at bottom, consider it "at bottom"
        for (let i = 0; i < wrappers.length; i++) {
            const wrapper = wrappers[i];
            const threshold = 50; // pixels from bottom
            if (wrapper.scrollHeight - wrapper.scrollTop - wrapper.clientHeight < threshold) {
                return true;
            }
        }
        
        return false;
    }

    // Stack management
    async function loadStacks() {
        const { app, utils, table } = deps;
        
        table.showLoading('stacks-table');
        
        try {
            // Ensure directory exists and get stacks
            const command = [
                'sh', '-c',
                `mkdir -p "${app.stacksPath}" && find "${app.stacksPath}" -maxdepth 1 -type d -not -path "${app.stacksPath}" | sort`
            ];
            
            const result = await utils.executeCommand(command, { 
                superuser: 'try', 
                suppressError: true 
            });
            
            if (!result.success || !result.data.trim()) {
                app.stacks = [];
                renderStacks();
                return;
            }
            
            const stackPaths = result.data.split('\n').filter(Boolean);
            const stackNames = stackPaths.map(path => path.substring(app.stacksPath.length + 1));
            
            // Load all stack details in parallel
            app.stacks = await Promise.all(stackNames.map(loadStackDetails));
            renderStacks();
            
        } catch (error) {
            app.stacks = [];
            table.showError('stacks-table', 'Failed to load stacks');
        }
    }

    async function loadStackDetails(stackName) {
        const [composeResult, containersResult] = await Promise.all([
            fileOps.read(stackName, 'compose'),
            containerUtils.getContainers(stackName)
        ]);
        
        const stack = {
            name: stackName,
            content: composeResult.success ? composeResult.data : null,
            hasError: !composeResult.success,
            ports: composeResult.success ? parseUtils.ports(composeResult.data) : [],
            containers: [],
            status: 'stopped',
            uptime: 'Stopped'
        };
        
        if (containersResult.success && containersResult.data.trim()) {
            const containers = containerUtils.parseContainers(containersResult.data);
            stack.containers = containers;
            stack.uptime = containerUtils.getStackUptime(containers);
            
            const runningCount = containers.filter(c => c.state === 'running').length;
            if (containers.length > 0) {
                stack.status = runningCount === 0 ? 'stopped' : 
                    runningCount === containers.length ? 'running' : 'partial';
            }
        }
        
        return stack;
    }

    function renderStacks() {
        deps.table.renderTable('stacks-table', deps.app.stacks);
    }

    function renderStackActions(stack) {
        const { utils, app } = deps;
        const actions = [];
        
        if (stack.status === 'running' || stack.status === 'partial') {
            actions.push(
                { label: 'View', className: 'primary', action: 'viewStack' },
                app.stackUpdates[stack.name] && { label: 'Update', className: 'info', action: 'updateStack' },
                { label: 'Restart', className: 'warning', action: 'restartStack' },
                { label: 'Stop', className: 'danger', action: 'stopStack' }
            );
        } else {
            actions.push(
                { label: 'Edit', className: 'primary', action: 'editStack' },
                !stack.hasError && { label: 'Start', className: 'success', action: 'startStack' },
                { label: 'Remove', className: 'danger', action: 'removeStack' }
            );
        }
        
        const buttons = actions
            .filter(Boolean)
            .map(({ label, className, action }) => 
                `<button class="table-action-btn ${className}" data-action="${action}" data-name="${utils.escapeHtml(stack.name)}">${label}</button>`
            )
            .join('');
        
        return `<div class="table-action-buttons">${buttons}</div>`;
    }

    // Stack operations
    async function handleCreateStack(formData) {
        const { app, utils } = deps;
        const stackName = formData['stack-name'];
        const content = formData['docker-compose-content'];
        const envContent = formData['env-content'];
        
        utils.showNotification(`Creating stack "${stackName}"...`, 'info', { persist: true });
        
        // Check if exists
        const stackDir = `${app.stacksPath}/${stackName}`;
        const checkResult = await utils.executeCommand(['test', '-d', stackDir], {
            superuser: 'try',
            suppressError: true
        });
        
        if (checkResult.success) {
            throw { field: 'stack-name', message: `Stack "${stackName}" already exists` };
        }
        
        return createStackSequence(stackName, content, envContent);
    }

    async function createStackSequence(stackName, content, envContent) {
        const { utils } = deps;
        
        try {
            // Write files
            utils.showNotification('Writing configuration files...', 'info', { persist: true });
            await fileOps.write(stackName, 'compose', content);
            
            if (envContent) {
                await fileOps.write(stackName, 'env', envContent);
            }
            
            // Create build contexts if needed
            await createBuildContexts(stackName, content);
            
            // Validate
            utils.showNotification('Validating configuration...', 'info', { persist: true });
            const validateResult = await utils.runDockerCompose(stackName, ['config'], { 
                suppressError: true 
            });
            
            if (!validateResult.success) {
                const error = utils.parseDockerError(validateResult.error || validateResult.data);
                utils.showNotification(`Stack "${stackName}" created with warnings: ${error}`, 'warning');
            } else {
                utils.showNotification(`Stack "${stackName}" created successfully. Use the Start button to launch it.`, 'success');
            }
            
            loadStacks();
            return true;
            
        } finally {
            utils.hideProgressNotification();
        }
    }

    async function handleSaveStack(stackName, formData) {
        const { utils } = deps;
        const content = formData['docker-compose-content'];
        const envContent = formData['env-content'];
        
        utils.showNotification(`Saving stack "${stackName}"...`, 'info', { persist: true });
        
        try {
            await fileOps.write(stackName, 'compose', content);
            await fileOps.write(stackName, 'env', envContent);
            await createBuildContexts(stackName, content);
            
            const validateResult = await utils.runDockerCompose(stackName, ['config'], {
                suppressError: true
            });
            
            if (!validateResult.success) {
                const error = utils.parseDockerError(validateResult.error || validateResult.data);
                utils.showNotification(`Stack "${stackName}" saved with warnings: ${error}`, 'warning');
            } else {
                utils.showNotification(`Stack "${stackName}" saved successfully`, 'success');
            }
            
            loadStacks();
            return true;
            
        } finally {
            utils.hideProgressNotification();
        }
    }

    async function createBuildContexts(stackName, content) {
        const { app, utils } = deps;
        const buildPaths = [];
        
        // Extract build paths
        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('build:')) {
                let buildPath = trimmed.substring(6).trim().replace(/['"]/g, '');
                if (buildPath.startsWith('./')) buildPath = buildPath.substring(2);
                if (buildPath && !buildPath.startsWith('/')) {
                    buildPaths.push(buildPath);
                }
            }
        });
        
        if (buildPaths.length === 0) return;
        
        // Create directories and Dockerfiles
        await Promise.all(buildPaths.map(async buildPath => {
            const fullPath = `${app.stacksPath}/${stackName}/${buildPath}`;
            
            await utils.executeCommand(['mkdir', '-p', fullPath], { superuser: 'require' });
            
            const checkResult = await utils.executeCommand(['test', '-f', `${fullPath}/Dockerfile`], {
                superuser: 'try',
                suppressError: true
            });
            
            if (!checkResult.success) {
                const dockerfileContent = `# Auto-generated Dockerfile
FROM nginx:alpine

# Add your custom configuration here
# COPY ./config /etc/nginx/conf.d/
# COPY ./html /usr/share/nginx/html/

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
                await fileOps.write(`${stackName}/${buildPath}`, 'Dockerfile', dockerfileContent);
            }
        }));
    }

    // Update operations
    const updateChecker = {
        async checkAllStacks(showNotifications) {
            const { app, utils, config } = deps;
            
            if (showNotifications) {
                utils.showNotification('Checking for stack updates...', 'info');
            }
            
            try {
                // Get all images from all stacks
                const allImages = app.stacks
                    .filter(stack => stack.content)
                    .flatMap(stack => parseUtils.images(stack.content)
                        .map(image => ({ stackName: stack.name, image }))
                    );
                
                // Check unique images
                const uniqueImages = [...new Set(allImages.map(item => item.image))];
                const imageResults = await Promise.all(
                    uniqueImages.map(image => this.checkImage(image))
                );
                
                // Build update data
                const updateData = {
                    lastCheck: Date.now(),
                    updates: {}
                };
                
                // Map results to stacks
                app.stacks.forEach(stack => {
                    const stackImages = allImages
                        .filter(item => item.stackName === stack.name)
                        .map(item => item.image);
                    
                    const hasUpdates = stackImages.some(image => {
                        const result = imageResults.find(r => r.image === image);
                        return result?.hasUpdate;
                    });
                    
                    app.stackUpdates[stack.name] = hasUpdates;
                    updateData.updates[stack.name] = { hasUpdates };
                });
                
                // Save and notify
                await config.saveUpdateCheckData(updateData);
                
                if (showNotifications) {
                    const hasAnyUpdates = Object.values(app.stackUpdates).some(Boolean);
                    utils.showNotification(
                        hasAnyUpdates ? 'Updates available for some stacks' : 'All stacks are up to date',
                        hasAnyUpdates ? 'info' : 'success'
                    );
                }
                
                renderStacks();
                return updateData;
                
            } catch (error) {
                if (showNotifications) {
                    utils.showNotification(`Failed to check for updates: ${error.message}`, 'error');
                }
                throw error;
            }
        },
        
        async checkImage(image) {
            const { utils } = deps;
            
            try {
                // Try to inspect both local and remote
                const [localResult, remoteResult] = await Promise.all([
                    utils.executeCommand(['docker', 'image', 'inspect', image, '--format', '{{index .RepoDigests 0}}'], {
                        superuser: 'try',
                        suppressError: true
                    }),
                    utils.executeCommand(['docker', 'manifest', 'inspect', image], {
                        superuser: 'try',
                        suppressError: true
                    })
                ]);
                
                if (localResult.success && remoteResult.success) {
                    const localDigest = localResult.data.trim();
                    try {
                        const manifest = JSON.parse(remoteResult.data);
                        const remoteDigest = manifest.config?.digest;
                        return {
                            image,
                            hasUpdate: localDigest && remoteDigest && localDigest !== remoteDigest
                        };
                    } catch {
                        return { image, hasUpdate: false };
                    }
                }
                
                return { image, hasUpdate: false };
            } catch {
                return { image, hasUpdate: false };
            }
        }
    };

    async function updateStack(stackName) {
        const { modals } = deps;
        
        const confirmed = await modals.confirm(
            `Update stack "${stackName}"? This will pull the latest images and recreate containers.`,
            {
                title: 'Update Stack',
                confirmLabel: 'Update'
            }
        );
        
        if (confirmed) {
            await safeUpdateStack(stackName);
        }
    }

    async function safeUpdateStack(stackName) {
        const { app, utils } = deps;
        
        utils.showNotification(`Preparing to update stack "${stackName}"...`, 'info', { persist: true });
        
        try {
            // Create backup marker
            const backupPath = `${app.stacksPath}/${stackName}/.backup.json`;
            await fileOps.write(stackName, '.backup.json', JSON.stringify({ timestamp: Date.now() }, null, 2));
            
            // Update steps
            const steps = [
                {
                    message: `Pulling latest images for "${stackName}"...`,
                    command: ['pull']
                },
                {
                    message: `Recreating containers for "${stackName}"...`,
                    command: ['up', '-d', '--force-recreate']
                },
                {
                    message: 'Cleaning old images...',
                    command: ['image', 'prune', '-f']
                }
            ];
            
            for (const step of steps) {
                utils.showNotification(step.message, 'info', { persist: true });
                
                const result = await (step.command[0] === 'image' 
                    ? utils.executeCommand(['docker', ...step.command], { superuser: 'require' })
                    : utils.runDockerCompose(stackName, step.command));
                
                if (!result.success) {
                    throw new Error(utils.parseDockerError(result.error));
                }
            }
            
            utils.showNotification(`Stack "${stackName}" updated successfully`, 'success');
            await updateChecker.checkAllStacks(false);
            loadStacks();
            
        } catch (error) {
            utils.showNotification(`Update failed: ${error.message}`, 'error');
            throw error;
        } finally {
            utils.hideProgressNotification();
        }
    }

    async function updateAllStacks() {
        const { app, utils, modals } = deps;
        const stacksToUpdate = Object.entries(app.stackUpdates)
            .filter(([name, hasUpdate]) => hasUpdate)
            .map(([name]) => name);
        
        if (stacksToUpdate.length === 0) {
            utils.showNotification('No stacks need updating', 'info');
            return;
        }
        
        const confirmed = await modals.confirm(
            `Update ${stacksToUpdate.length} stack${stacksToUpdate.length > 1 ? 's' : ''}? This will pull latest images and recreate containers.`,
            {
                title: 'Update All Stacks',
                confirmLabel: 'Update All'
            }
        );
        
        if (!confirmed) return;
        
        utils.showNotification(`Starting update of ${stacksToUpdate.length} stacks...`, 'info', { persist: true });
        
        let currentIndex = 0;
        for (const stackName of stacksToUpdate) {
            utils.showNotification(`Updating stack ${++currentIndex} of ${stacksToUpdate.length}: ${stackName}`, 'info', { persist: true });
            
            try {
                await safeUpdateStack(stackName);
            } catch (error) {
                utils.showNotification(`Failed to update ${stackName}, continuing with next stack`, 'warning');
            }
        }
        
        utils.showNotification('All stacks updated', 'success');
        updateChecker.checkAllStacks(false);
    }

    async function removeStack(stackName) {
        const { app, utils, modals } = deps;
        const operationKey = `remove-${stackName}`;
        
        if (state.activeOperations.has(operationKey)) {
            utils.showNotification('Operation already in progress', 'warning');
            return;
        }
        
        const confirmed = await modals.confirm(
            `Remove stack "${stackName}"? This will stop all containers and delete the stack configuration.`,
            {
                title: 'Remove Stack',
                confirmLabel: 'Remove'
            }
        );
        
        if (!confirmed) return;
        
        state.activeOperations.add(operationKey);
        
        const button = document.querySelector(`[data-action="removeStack"][data-name="${stackName}"]`);
        if (button) utils.dom.setLoading(button, true, 'Removing...');
        
        try {
            utils.showNotification(`Removing stack "${stackName}"...`, 'info', { persist: true });
            
            // Stop and remove containers
            await utils.runDockerComposeStreaming(stackName, ['down', '-v'], {
                onProgress(progress) {
                    if (progress.message?.includes('Stopping')) {
                        utils.showNotification('Stopping containers...', 'info', { persist: true });
                    } else if (progress.message?.includes('Removing')) {
                        utils.showNotification('Removing containers and volumes...', 'info', { persist: true });
                    }
                }
            });
            
            // Delete stack directory
            utils.showNotification('Deleting stack configuration...', 'info', { persist: true });
            const result = await utils.executeCommand(['rm', '-rf', `${app.stacksPath}/${stackName}`], {
                superuser: 'require'
            });
            
            if (result.success) {
                utils.showNotification(`Stack "${stackName}" removed`, 'success');
                loadStacks();
            } else {
                throw new Error(utils.parseDockerError(result.error));
            }
            
        } catch (error) {
            utils.showNotification(`Failed to remove stack: ${error.message}`, 'error');
        } finally {
            state.activeOperations.delete(operationKey);
            utils.hideProgressNotification();
            if (button) utils.dom.setLoading(button, false);
        }
    }

    // Initialize
    function initialize() {
        initializeTable();
        initializeModals();
        setupViewModal();
    }

    function initializeTable() {
        const { table, utils } = deps;
        
        table.registerTable('stacks-table', {
            columns: [
                {
                    key: 'name',
                    label: 'Stack Name',
                    renderer(value, item) {
                        const { app } = deps;
                        let html = `<strong>${utils.escapeHtml(value)}</strong>`;
                        if (item.hasError) html += '<span class="error-indicator" title="Configuration has errors">⚠️</span>';
                        if (app.stackUpdates[value]) html += '<span class="update-indicator" title="Updates available">🔄</span>';
                        return html;
                    }
                },
                { key: 'uptime', label: 'Uptime', sortTransform: utils.parseTime },
                {
                    key: 'status',
                    label: 'Status',
                    renderer(value) {
                        const statusText = value === 'error' ? 'Error' : value.charAt(0).toUpperCase() + value.slice(1);
                        return `<span class="status-badge-small ${value}">${statusText}</span>`;
                    }
                },
                {
                    key: 'actions',
                    label: 'Actions',
                    className: 'actions-column',
                    renderer: (value, item) => renderStackActions(item)
                }
            ],
            searchColumns: [0],
            emptyMessage: 'No stacks found. Click "Add stack" to create your first stack.',
            defaultSort: { column: 0, order: 'asc' }
        });
    }

    function initializeModals() {
        const { modals, utils } = deps;
        
        modals.registerModal('stack-modal', {
            title: data => data?.mode === 'edit' ? `Edit Stack: ${data.stackName}` : 'Create New Stack',
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
                'stack-name': value => utils.validators.resourceName(value, 'Stack'),
                'docker-compose-content'(value) {
                    if (!value) return 'Docker Compose configuration is required';
                    const validation = utils.validateYamlContent(value);
                    if (!validation.valid) return validation.error;
                    if (!value.includes('services:')) return 'Configuration must contain a "services:" section';
                    return null;
                }
            },
            async onShow(data) {
                const nameInput = utils.getElement('stack-name');
                const contentTextarea = utils.getElement('docker-compose-content');
                const envTextarea = utils.getElement('env-content');
                
                if (data?.mode === 'edit') {
                    nameInput.disabled = true;
                    nameInput.value = data.stackName;
                    
                    const [composeResult, envResult] = await Promise.all([
                        fileOps.read(data.stackName, 'compose'),
                        fileOps.read(data.stackName, 'env')
                    ]);
                    
                    contentTextarea.value = composeResult.success 
                        ? composeResult.data 
                        : `# Failed to load configuration\n# Error: ${composeResult.error || 'Unknown error'}`;
                    
                    envTextarea.value = envResult.success ? envResult.data : '';
                    
                    if (composeResult.success) {
                        setTimeout(() => {
                            contentTextarea.focus();
                            contentTextarea.setSelectionRange(0, 0);
                        }, 100);
                    }
                } else {
                    nameInput.disabled = false;
                    setTimeout(() => nameInput.focus(), 100);
                }
            },
            onSubmit(formData) {
                const mode = utils.getElement('stack-name').disabled ? 'edit' : 'create';
                return mode === 'create' 
                    ? handleCreateStack(formData) 
                    : handleSaveStack(formData['stack-name'], formData);
            },
            submitLabel: data => data?.mode === 'edit' ? 'Save' : 'Create'
        });
    }

    function setupViewModal() {
        const { utils } = deps;
        
        const closeBtn = utils.getElement('close-view-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', hideViewModal);
        }
        
        // Setup tab clicks
        document.querySelectorAll('#view-modal-tabs .modal-tab').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (state.viewModal.stackName) {
                    switchViewModalTab(btn.dataset.tab);
                }
            });
        });
        
        // Setup log filter
        const logsFilter = utils.getElement('logs-filter');
        if (logsFilter) {
            let filterTimeout;
            logsFilter.addEventListener('input', function() {
                clearTimeout(filterTimeout);
                filterTimeout = setTimeout(function() {
                    if (state.viewModal.activeTab === 'logs') {
                        loadStackLogs();
                    }
                }, 300);
            });
        }
    }

    // Initialize on load
    initialize();

    // Export public interface
    window.DockerManager.stacks = {
        loadStacks,
        renderStacks,
        checkAllStacksForUpdates: updateChecker.checkAllStacks.bind(updateChecker),
        updateAllStacks,
        showStackModal: mode => deps.modals.showModal('stack-modal', { mode }),
        hideStackModal: () => deps.modals.hideModal('stack-modal'),
        showViewStackModal: showViewModal,
        hideViewStackModal: hideViewModal,
        switchViewModalTab,
        loadStackLogs,
        ...stackActions
    };

})();
