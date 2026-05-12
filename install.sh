#!/bin/bash

# ══════════════════════════════════════════════════════════════
#  Docklet — Production Installer
#  Copyright (c) 2026 Docklet  |  https://github.com/rehan3web/Docker
# ══════════════════════════════════════════════════════════════

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

REPO_URL="https://github.com/rehan3web/Docker.git"
INSTALL_DIR="/opt/docklet"
COMPOSE_FILE="docker-compose.yml"

# ── Helpers ──────────────────────────────────────────────────
info()    { echo -e "${BLUE}[•]${NC} $*"; }
success() { echo -e "${GREEN}[✔]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✘]${NC} $*"; }
header()  { echo -e "\n${BOLD}${CYAN}$*${NC}"; }

banner() {
  echo -e "${CYAN}"
  echo "  ╔══════════════════════════════════════════╗"
  echo "  ║         Docklet — Production Installer   ║"
  echo "  ║         https://github.com/rehan3web     ║"
  echo "  ╚══════════════════════════════════════════╝"
  echo -e "${NC}"
}

require_root() {
  if [ "$EUID" -ne 0 ]; then
    error "Please run as root:  sudo bash install.sh"
    exit 1
  fi
}

command_exists() { command -v "$1" >/dev/null 2>&1; }

port_in_use() {
  ss -tuln 2>/dev/null | grep -q ":$1 " || \
  netstat -tuln 2>/dev/null | grep -q ":$1 "
}

# ── Prerequisite check / install ─────────────────────────────
install_prerequisites() {
  header "Checking prerequisites…"

  # Docker
  if command_exists docker; then
    success "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
  else
    info "Installing Docker…"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    success "Docker installed"
  fi

  # Docker Compose (plugin)
  if docker compose version >/dev/null 2>&1; then
    success "Docker Compose $(docker compose version --short 2>/dev/null || echo 'v2')"
  else
    info "Installing Docker Compose plugin…"
    apt-get update -qq && apt-get install -y -qq docker-compose-plugin || {
      mkdir -p "${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins"
      curl -SL "https://github.com/docker/compose/releases/download/v2.27.0/docker-compose-linux-$(uname -m)" \
        -o "${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins/docker-compose"
      chmod +x "${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins/docker-compose"
    }
    success "Docker Compose installed"
  fi

  # Git
  if command_exists git; then
    success "Git $(git --version | awk '{print $3}')"
  else
    info "Installing Git…"
    apt-get update -qq && apt-get install -y -qq git
    success "Git installed"
  fi

  # openssl (for JWT secret generation)
  if ! command_exists openssl; then
    apt-get update -qq && apt-get install -y -qq openssl
  fi
}

# ── Port check ────────────────────────────────────────────────
check_ports() {
  header "Checking required ports…"
  local failed=0
  for port in 80 443 3000; do
    if port_in_use "$port"; then
      error "Port $port is already in use"
      failed=1
    else
      success "Port $port is free"
    fi
  done
  if [ "$failed" -eq 1 ]; then
    error "Free the ports above, then re-run the installer."
    exit 1
  fi
}

# ── Interactive .env configuration ───────────────────────────
configure_env() {
  header "Configuration"
  echo -e "${YELLOW}Press Enter to accept the default shown in [brackets].${NC}\n"

  # Database
  read -rp "$(echo -e "  ${BOLD}Postgres database name${NC} [docklet]: ")" DB_NAME
  DB_NAME="${DB_NAME:-docklet}"

  read -rp "$(echo -e "  ${BOLD}Postgres username${NC} [docklet]: ")" DB_USERNAME
  DB_USERNAME="${DB_USERNAME:-docklet}"

  while true; do
    read -rsp "$(echo -e "  ${BOLD}Postgres password${NC}: ")" DB_PASSWORD; echo
    read -rsp "$(echo -e "  Confirm password: ")" DB_PASSWORD2; echo
    [ "$DB_PASSWORD" = "$DB_PASSWORD2" ] && [ -n "$DB_PASSWORD" ] && break
    warn "Passwords do not match or are empty. Try again."
  done

  echo
  # Admin account
  read -rp "$(echo -e "  ${BOLD}Admin username${NC} [admin]: ")" ADMIN_USERNAME
  ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"

  while true; do
    read -rsp "$(echo -e "  ${BOLD}Admin password${NC} (min 8 chars): ")" ADMIN_PASSWORD; echo
    read -rsp "$(echo -e "  Confirm password: ")" ADMIN_PASSWORD2; echo
    [ "$ADMIN_PASSWORD" = "$ADMIN_PASSWORD2" ] && [ "${#ADMIN_PASSWORD}" -ge 8 ] && break
    warn "Passwords do not match or are less than 8 characters. Try again."
  done

  echo
  # SSL / ACME
  read -rp "$(echo -e "  ${BOLD}SSL / Let's Encrypt email${NC}: ")" ACME_EMAIL
  while [[ ! "$ACME_EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; do
    warn "Enter a valid email address."
    read -rp "$(echo -e "  ${BOLD}SSL / Let's Encrypt email${NC}: ")" ACME_EMAIL
  done

  echo
  # 2FA
  echo -e "  ${BOLD}Enable Two-Factor Authentication (2FA)?${NC}"
  echo -e "  ${YELLOW}[Y]${NC} Yes — require TOTP on login"
  echo -e "  ${YELLOW}[N]${NC} No  — password only (can enable later in Settings)"
  read -rp "  Choice [N]: " TFA_CHOICE
  if [[ "${TFA_CHOICE,,}" == "y" ]]; then
    ENABLE_2FA="true"
    success "2FA enabled"
  else
    ENABLE_2FA="false"
    info "2FA disabled (toggle any time in Settings → 2FA)"
  fi

  # Auto-generate JWT secret
  JWT_SECRET="$(openssl rand -hex 32)"
}

# ── Write .env ────────────────────────────────────────────────
write_env() {
  cat > .env << EOF
# ── Database ──────────────────────────────────────────────
DB_NAME=${DB_NAME}
DB_USERNAME=${DB_USERNAME}
DB_PASSWORD=${DB_PASSWORD}

# ── Admin account ─────────────────────────────────────────
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# ── Security ──────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}

# ── SSL / Let's Encrypt ───────────────────────────────────
# Your email address for cert expiry notices (required).
ACME_EMAIL=${ACME_EMAIL}

# ── Two-Factor Authentication ─────────────────────────────
# true  = TOTP required at login
# false = password only (can be changed in Settings → 2FA)
ENABLE_2FA=${ENABLE_2FA}
EOF
  success ".env written"
}

# ── Clone or update repo ──────────────────────────────────────
clone_or_update() {
  if [ -d ".git" ]; then
    info "Updating repository…"
    git pull
  elif [ -d "$INSTALL_DIR/.git" ]; then
    cd "$INSTALL_DIR"
    info "Updating repository in $INSTALL_DIR…"
    git pull
  else
    info "Cloning Docklet into $INSTALL_DIR…"
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
}

# ── Start containers ─────────────────────────────────────────
start_containers() {
  info "Building and starting containers (this may take a few minutes)…"
  docker compose -f "$COMPOSE_FILE" up -d --build
  success "All containers started"
}

# ── Show success summary ──────────────────────────────────────
show_summary() {
  local ip
  ip="$(curl -s --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
  echo
  echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║      Docklet Installed Successfully! ✔       ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
  echo
  echo -e "  ${BOLD}Dashboard (direct):${NC}   ${CYAN}http://$ip:3000${NC}"
  echo -e "  ${BOLD}Dashboard (via 80):${NC}   ${CYAN}http://$ip${NC}"
  echo
  echo -e "  ${BOLD}Admin username:${NC}  $ADMIN_USERNAME"
  echo -e "  ${BOLD}Admin password:${NC}  (the password you entered)"
  echo -e "  ${BOLD}2FA:${NC}             $ENABLE_2FA"
  echo -e "  ${BOLD}SSL email:${NC}       $ACME_EMAIL"
  echo
  echo -e "  ${YELLOW}Tip:${NC} Point a domain A-record to $ip, then use"
  echo -e "       Docklet's Reverse Proxy page to enable HTTPS."
  echo
}

# ════════════════════════════════════════════════════════════
#  ACTION FUNCTIONS
# ════════════════════════════════════════════════════════════

do_install() {
  header "Installing Docklet…"
  install_prerequisites
  check_ports
  clone_or_update
  configure_env
  write_env
  start_containers
  show_summary
}

do_repair() {
  header "Repairing Docklet…"

  # Navigate to install dir if needed
  if [ ! -f "$COMPOSE_FILE" ] && [ -f "$INSTALL_DIR/$COMPOSE_FILE" ]; then
    cd "$INSTALL_DIR"
  elif [ ! -f "$COMPOSE_FILE" ]; then
    error "Cannot find docker-compose.yml. Run from your Docklet directory or use Install first."
    exit 1
  fi

  info "Pulling latest code…"
  git pull

  info "Rebuilding and restarting containers…"
  docker compose -f "$COMPOSE_FILE" up -d --build

  success "Repair complete."
  docker compose -f "$COMPOSE_FILE" ps
}

do_restart() {
  header "Restarting Docklet…"

  if [ ! -f "$COMPOSE_FILE" ] && [ -f "$INSTALL_DIR/$COMPOSE_FILE" ]; then
    cd "$INSTALL_DIR"
  elif [ ! -f "$COMPOSE_FILE" ]; then
    error "Cannot find docker-compose.yml. Run from your Docklet directory."
    exit 1
  fi

  docker compose -f "$COMPOSE_FILE" restart
  success "All services restarted."
  docker compose -f "$COMPOSE_FILE" ps
}

do_uninstall() {
  header "Uninstalling Docklet…"
  warn "This will stop and remove all Docklet containers."

  read -rp "$(echo -e "  ${RED}Also delete all data (database, certs, configs)?${NC} [y/N]: ")" DEL_DATA
  read -rp "$(echo -e "  ${RED}Type 'yes' to confirm uninstall:${NC} ")" CONFIRM

  if [ "$CONFIRM" != "yes" ]; then
    info "Uninstall cancelled."
    exit 0
  fi

  if [ ! -f "$COMPOSE_FILE" ] && [ -f "$INSTALL_DIR/$COMPOSE_FILE" ]; then
    cd "$INSTALL_DIR"
  fi

  if [ -f "$COMPOSE_FILE" ]; then
    if [[ "${DEL_DATA,,}" == "y" ]]; then
      info "Stopping containers and removing volumes…"
      docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
    else
      info "Stopping containers (keeping volumes)…"
      docker compose -f "$COMPOSE_FILE" down --remove-orphans
    fi
    success "Containers removed."
  else
    warn "docker-compose.yml not found — skipping container removal."
  fi

  if [[ "${DEL_DATA,,}" == "y" ]]; then
    if [ -d "$INSTALL_DIR" ]; then
      info "Removing $INSTALL_DIR…"
      rm -rf "$INSTALL_DIR"
      success "$INSTALL_DIR removed."
    fi
  fi

  success "Docklet uninstalled."
}

toggle_2fa() {
  header "2FA Toggle"

  if [ ! -f "$COMPOSE_FILE" ] && [ -f "$INSTALL_DIR/$COMPOSE_FILE" ]; then
    cd "$INSTALL_DIR"
  fi

  if [ ! -f ".env" ]; then
    error ".env not found. Run from your Docklet directory."
    exit 1
  fi

  CURRENT=$(grep -E '^ENABLE_2FA=' .env | cut -d= -f2 | tr -d '[:space:]')
  echo -e "  Current 2FA status: ${BOLD}${CURRENT:-false}${NC}"

  if [[ "$CURRENT" == "true" ]]; then
    read -rp "  2FA is currently ENABLED. Disable it? [y/N]: " CHOICE
    if [[ "${CHOICE,,}" == "y" ]]; then
      sed -i 's/^ENABLE_2FA=.*/ENABLE_2FA=false/' .env
      success "2FA disabled. Restarting backend…"
      docker compose -f "$COMPOSE_FILE" restart docklet-server
    else
      info "No changes made."
    fi
  else
    read -rp "  2FA is currently DISABLED. Enable it? [y/N]: " CHOICE
    if [[ "${CHOICE,,}" == "y" ]]; then
      sed -i 's/^ENABLE_2FA=.*/ENABLE_2FA=true/' .env
      success "2FA enabled. Restarting backend…"
      docker compose -f "$COMPOSE_FILE" restart docklet-server
      echo
      info "Visit Settings → 2FA in the Docklet dashboard to scan your QR code."
    else
      info "No changes made."
    fi
  fi
}

# ════════════════════════════════════════════════════════════
#  MAIN MENU
# ════════════════════════════════════════════════════════════

main_menu() {
  banner
  require_root

  echo -e "  ${BOLD}What would you like to do?${NC}\n"
  echo -e "  ${GREEN}1)${NC} Install Docklet"
  echo -e "  ${BLUE}2)${NC} Repair  (pull latest code + rebuild)"
  echo -e "  ${YELLOW}3)${NC} Restart app"
  echo -e "  ${CYAN}4)${NC} Toggle 2FA on/off"
  echo -e "  ${RED}5)${NC} Uninstall Docklet"
  echo -e "  ${NC}6)${NC} Exit"
  echo

  read -rp "  Enter choice [1-6]: " CHOICE

  case "$CHOICE" in
    1) do_install   ;;
    2) do_repair    ;;
    3) do_restart   ;;
    4) toggle_2fa   ;;
    5) do_uninstall ;;
    6) echo -e "  Bye!"; exit 0 ;;
    *) error "Invalid choice '$CHOICE'"; main_menu ;;
  esac
}

# ── Entry point ───────────────────────────────────────────────
# If an argument is passed, run that action directly:
#   sudo bash install.sh install
#   sudo bash install.sh repair
#   sudo bash install.sh restart
#   sudo bash install.sh 2fa
#   sudo bash install.sh uninstall

case "${1:-menu}" in
  install)   require_root; install_prerequisites; check_ports; clone_or_update; configure_env; write_env; start_containers; show_summary ;;
  repair)    require_root; do_repair    ;;
  restart)   require_root; do_restart   ;;
  2fa)       require_root; toggle_2fa   ;;
  uninstall) require_root; do_uninstall ;;
  menu|*)    main_menu ;;
esac
