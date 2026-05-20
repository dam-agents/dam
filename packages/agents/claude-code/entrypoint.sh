#!/bin/bash
set -e

if [ "$PLATFORM_EDITOR" = "1" ] && [ -n "$PLATFORM_EDITOR_PUBKEY" ]; then
  echo "[editor] starting sshd on :2222"
  SSHD_DIR=/tmp/sshd
  mkdir -p "$SSHD_DIR"
  ssh-keygen -t ed25519 -f "$SSHD_DIR/host_ed25519" -N "" -q
  printf '%s\n' "$PLATFORM_EDITOR_PUBKEY" > "$SSHD_DIR/authorized_keys"
  chmod 600 "$SSHD_DIR/authorized_keys"

  mkdir -p /home/agent/.ssh
  chmod 700 /home/agent/.ssh
  ENV_OUT=/home/agent/.ssh/environment
  : > "$ENV_OUT"
  while IFS= read -r -d '' line; do
    key="${line%%=*}"
    case "$key" in
      ''|PS1|PWD|OLDPWD|SHLVL|_|TERM|SHELL|HOSTNAME|HOME|USER|LOGNAME) ;;
      *) printf '%s\n' "$line" >> "$ENV_OUT" ;;
    esac
  done < /proc/self/environ
  chmod 600 "$ENV_OUT"

  cat > "$SSHD_DIR/sshd_config" <<EOF
Port 2222
ListenAddress 0.0.0.0
HostKey $SSHD_DIR/host_ed25519
AuthorizedKeysFile $SSHD_DIR/authorized_keys
PidFile $SSHD_DIR/sshd.pid
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
UsePAM no
StrictModes no
UsePrivilegeSeparation no
PermitUserEnvironment yes
Subsystem sftp /usr/libexec/openssh/sftp-server
EOF
  /usr/sbin/sshd -f "$SSHD_DIR/sshd_config" -D -e &
fi

exec "$@"
