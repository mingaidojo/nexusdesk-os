#!/usr/bin/env bash
# ==============================================================================
# NexusDesk Service & Daemon Manager CLI
# Location: /home/myvirtualcoder/nexusdesk/manage.sh
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="${NEXUSDESK_SERVICE:-nexusdesk}"
PROJECT_DIR="$SCRIPT_DIR"
if [ -n "${NEXUSDESK_PYTHON:-}" ] && [ -x "$NEXUSDESK_PYTHON" ]; then
  PYTHON_BIN="$NEXUSDESK_PYTHON"
elif [ -x "$PROJECT_DIR/.venv/bin/python" ]; then
  PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"
elif [ -x "/usr/local/lib/hermes-agent/venv/bin/python" ]; then
  PYTHON_BIN="/usr/local/lib/hermes-agent/venv/bin/python"
else
  PYTHON_BIN="$(command -v python3)"
fi
SERVER_SCRIPT="$PROJECT_DIR/backend/server.py"
NEXUSDESK_PORT="${NEXUSDESK_PORT:-$(grep -E '^NEXUSDESK_PORT=' "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d '"\r ')}"
NEXUSDESK_PORT="${NEXUSDESK_PORT:-9200}"

# Colors for terminal styling
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_banner() {
  echo -e "${CYAN}╔════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║            NexusDesk Daemon Control CLI            ║${NC}"
  echo -e "${CYAN}╚════════════════════════════════════════════════════╝${NC}"
}

usage() {
  print_banner
  echo -e "${YELLOW}Usage:${NC} $0 {start|stop|restart|reload|status|logs|build|rebuild|run-foreground|help}"
  echo ""
  echo "Commands:"
  echo -e "  ${GREEN}start${NC}           - Start the systemd service"
  echo -e "  ${GREEN}stop${NC}            - Stop the systemd service"
  echo -e "  ${GREEN}restart${NC}         - Reload daemon configuration and restart the service"
  echo -e "  ${GREEN}reload${NC}          - Run 'systemctl daemon-reload'"
  echo -e "  ${GREEN}status${NC}          - Check current service and process status"
  echo -e "  ${GREEN}logs${NC}            - Tail live systemd service journal logs (Ctrl+C to exit)"
  echo -e "  ${GREEN}build${NC}           - Compile the frontend bundle (frontend/dist/index.html)"
  echo -e "  ${GREEN}rebuild${NC}         - Compile frontend + daemon-reload + restart service"
  echo -e "  ${GREEN}run-foreground${NC}  - Run backend manually in foreground (stops background service first)"
  echo -e "  ${GREEN}help${NC}            - Show this help message"
  echo ""
}

case "$1" in
  start)
    echo -e "${CYAN}Starting $SERVICE_NAME service...${NC}"
    sudo systemctl start "$SERVICE_NAME"
    sudo systemctl is-active --quiet "$SERVICE_NAME" && echo -e "${GREEN}✓ $SERVICE_NAME is running.${NC}" || echo -e "${RED}✗ Failed to start $SERVICE_NAME.${NC}"
    ;;

  stop)
    echo -e "${YELLOW}Stopping $SERVICE_NAME service...${NC}"
    sudo systemctl stop "$SERVICE_NAME"
    echo -e "${GREEN}✓ $SERVICE_NAME stopped.${NC}"
    ;;

  restart)
    echo -e "${CYAN}Reloading systemd units and restarting $SERVICE_NAME...${NC}"
    sudo systemctl daemon-reload
    sudo systemctl restart "$SERVICE_NAME"
    sleep 1
    sudo systemctl is-active --quiet "$SERVICE_NAME" && echo -e "${GREEN}✓ $SERVICE_NAME successfully restarted.${NC}" || echo -e "${RED}✗ $SERVICE_NAME failed to restart.${NC}"
    ;;

  reload)
    echo -e "${CYAN}Running systemctl daemon-reload...${NC}"
    sudo systemctl daemon-reload
    echo -e "${GREEN}✓ Systemd unit cache reloaded.${NC}"
    ;;

  status)
    echo -e "${CYAN}=== NexusDesk Service Status ===${NC}"
    sudo systemctl status "$SERVICE_NAME" --no-pager || true
    echo ""
    echo -e "${CYAN}=== Listening Ports ($NEXUSDESK_PORT) ===${NC}"
    sudo ss -tulpn | grep "$NEXUSDESK_PORT" || echo "Port $NEXUSDESK_PORT is not currently listening."
    ;;

  logs)
    echo -e "${CYAN}Tailing live logs for $SERVICE_NAME (Ctrl+C to quit)...${NC}"
    sudo journalctl -u "$SERVICE_NAME" -f -n 50 --no-pager
    ;;

  build)
    echo -e "${CYAN}Compiling NexusDesk frontend...${NC}"
    cd "$PROJECT_DIR"
    python3 frontend/build.py
    echo -e "${GREEN}✓ Frontend build complete.${NC}"
    ;;

  rebuild)
    echo -e "${CYAN}Rebuilding frontend and restarting $SERVICE_NAME...${NC}"
    cd "$PROJECT_DIR"
    python3 frontend/build.py
    sudo systemctl daemon-reload
    sudo systemctl restart "$SERVICE_NAME"
    sleep 1
    sudo systemctl is-active --quiet "$SERVICE_NAME" && echo -e "${GREEN}✓ Frontend rebuilt and $SERVICE_NAME restarted successfully.${NC}" || echo -e "${RED}✗ Restart failed.${NC}"
    ;;

  run-foreground)
    echo -e "${YELLOW}Stopping background service to free port $NEXUSDESK_PORT...${NC}"
    sudo systemctl stop "$SERVICE_NAME" || true
    echo -e "${CYAN}Starting backend in foreground using $PYTHON_BIN...${NC}"
    echo -e "${YELLOW}Press Ctrl+C to terminate foreground process.${NC}\n"
    cd "$PROJECT_DIR/backend"
    sudo "$PYTHON_BIN" "$SERVER_SCRIPT"
    ;;

  help|--help|-h|"")
    usage
    ;;

  *)
    echo -e "${RED}Unknown command: $1${NC}"
    usage
    exit 1
    ;;
esac
