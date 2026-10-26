#!/bin/bash
# Uso: ./motor.sh <nome_ambiente> <limite_ram_bytes> <limite_cpu_pct> <limite_io_bps> <comando>

NOME_AMBIENTE=$1
LIMITE_RAM=$2
LIMITE_CPU=$3
LIMITE_IO=$4
SCRIPT_ALVO=$5

LOG_DIR="/home/vagrant/app/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/saida_${NOME_AMBIENTE}.txt"
EXIT_FILE="$LOG_DIR/exit_${NOME_AMBIENTE}.txt"

rm -f "$EXIT_FILE"

# 1. Cria cgroups (v1 ou v2 dependendo do sistema, com fallback seguro)
sudo cgcreate -g memory,cpu,blkio:/$NOME_AMBIENTE 2>/dev/null || true

# 2. Aplica limite de Memoria (em bytes)
if [ -n "$LIMITE_RAM" ] && [ "$LIMITE_RAM" -gt 0 ] 2>/dev/null; then
    sudo cgset -r memory.limit_in_bytes=$LIMITE_RAM $NOME_AMBIENTE 2>/dev/null || \
    sudo cgset -r memory.max=$LIMITE_RAM $NOME_AMBIENTE 2>/dev/null || true
fi

# 3. Aplica limite de CPU (porcentagem de 1 a 100 convertida para quota de 100000us)
if [ -n "$LIMITE_CPU" ] && [ "$LIMITE_CPU" -gt 0 ] 2>/dev/null; then
    QUOTA=$((LIMITE_CPU * 1000))
    sudo cgset -r cpu.cfs_period_us=100000 $NOME_AMBIENTE 2>/dev/null || true
    sudo cgset -r cpu.cfs_quota_us=$QUOTA $NOME_AMBIENTE 2>/dev/null || true
    sudo cgset -r cpu.shares=$((LIMITE_CPU * 10)) $NOME_AMBIENTE 2>/dev/null || true
fi

# 4. Aplica limite de IO (em bytes por segundo no disco principal 8:0)
if [ -n "$LIMITE_IO" ] && [ "$LIMITE_IO" -gt 0 ] 2>/dev/null; then
    sudo cgset -r blkio.throttle.read_bps_device="8:0 $LIMITE_IO" $NOME_AMBIENTE 2>/dev/null || true
    sudo cgset -r blkio.throttle.write_bps_device="8:0 $LIMITE_IO" $NOME_AMBIENTE 2>/dev/null || true
fi

# 5. Executa isolado em Namespace (PID + Mount) dentro do Cgroup e salva o exit code ao terminar
sudo cgexec -g memory,cpu,blkio:/$NOME_AMBIENTE \
    unshare -p -f --mount-proc \
    bash -c "$SCRIPT_ALVO; echo \$? > $EXIT_FILE" > "$LOG_FILE" 2>&1 &

PID=$!
echo "PID:$PID"