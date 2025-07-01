# Cockpit Docker Manager

A hacked, probably broken, Docker management plugin for [Cockpit](https://cockpit-project.org/) that provides a web interface for managing Docker containers, stacks, images, networks, and volumes.

## Installation

```bash
sudo mkdir -p /usr/share/cockpit/docker
sudo cp -r * /usr/share/cockpit/docker/
sudo systemctl reload cockpit
```

Access through Cockpit at `https://your-server:9090`

## Requirements

- Cockpit web console
- Docker Engine
- Docker Compose (v1 or v2)

## Core Features

**Stack Management**
- Create and manage Docker Compose stacks with YAML syntax highlighting
- Environment variable management through .env files
- Real-time container logs and statistics
- Automatic update checking and one-click updates
- Import/export for backup and migration

**Resource Management**
- Images: Pull, list, and remove Docker images
- Networks: Create and manage Docker networks
- Volumes: Create and manage persistent storage
- Built-in cleanup tools for unused resources

**Service Control**
- Monitor and control Docker daemon
- Start, stop, and restart Docker service

## Configuration

Default paths:
- Configuration: `/etc/cockpit/docker-manager.conf`
- Stacks: `/opt/stacks`

Stack storage location can be changed in Settings.

## Credits

Inspired by [Dockge](https://github.com/louislam/dockge) - thank you for the excellent UI/UX concepts that have been adapted for Cockpit.
