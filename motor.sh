#!/bin/bash

# Como rodar este script: 
# ./motor.sh "nome_do_ambiente" "limite_ram_em_bytes" "comando_ou_script_a_rodar"

NOME_AMBIENTE=$1
LIMITE_RAM=$2
SCRIPT_ALVO=$3

echo "1. Criando a jaula de recursos (Cgroup) chamada $NOME_AMBIENTE..."
sudo cgcreate -g memory,cpu:/$NOME_AMBIENTE

echo "2. Limitando a memória para $LIMITE_RAM bytes..."
sudo cgset -r memory.limit_in_bytes=$LIMITE_RAM $NOME_AMBIENTE

echo "3. Executando o programa isolado (Namespace) e salvando o log..."
# cgexec: Roda o processo dentro do limite de recurso criado.
# unshare -p -f --mount-proc: Isola a árvore de processos (namespaces).
# > saida_$NOME_AMBIENTE.txt: Direciona o output para um arquivo para o Veco mostrar na tela.

sudo cgexec -g memory,cpu:/$NOME_AMBIENTE unshare -p -f --mount-proc bash -c "$SCRIPT_ALVO" > "/home/vagrant/app/logs/saida_$NOME_AMBIENTE.txt" 2>&1 &

# Salva o número do processo (PID) para o Renato poder monitorar ou matar depois
PID=$!
echo "Processo rodando em background com PID: $PID"