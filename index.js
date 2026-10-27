//importacoes (express, mysql2, child_process, fs, path)
const express = require('express');
const mysql = require('mysql2');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

//configuracoes iniciais do Express e definicao de portas
const app = express();
const port = 3000;

//define 3 pastas dentro da VM: /home/vagrant/app/scripts (para scripts salvos), /home/vagrant/app/logs (para logs de execucao) e /home/vagrant/app/public (para arquivos estaticos)
const APP_DIR = '/home/vagrant/app';
const SCRIPTS_DIR = path.join(APP_DIR, 'scripts');
const LOGS_DIR = path.join(APP_DIR, 'logs');

//middlewares do Express para lidar com JSON, URL-encoded e arquivos estaticos
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(APP_DIR, 'public')));

// garante que as pastas existam (recursive cria a pasta pai se nao existir)
if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

// conexao com o MySQL
const db = mysql.createPool({
  host: 'localhost',
  user: 'api_user',
  password: 'senha_super_segura',
  database: 'gerenciador_processos',
  waitForConnections: true,
  connectionLimit: 10
});

// inicializacao das Tabelas do Banco de Dados
const inicializarBanco = () => {
  const sqlScripts = `
    CREATE TABLE IF NOT EXISTS scripts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      conteudo TEXT NOT NULL,
      caminho_arquivo VARCHAR(255) NOT NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const sqlAmbientes = `
    CREATE TABLE IF NOT EXISTS ambientes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome_ambiente VARCHAR(100) NOT NULL UNIQUE,
      pid INT NOT NULL,
      comando TEXT NOT NULL,
      limite_cpu INT DEFAULT 50,
      limite_ram BIGINT DEFAULT 50000000,
      limite_io BIGINT DEFAULT 10485760,
      status VARCHAR(30) DEFAULT 'Em execução',
      arquivo_log VARCHAR(255) NOT NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  //executa o sql e, quando termina, chama a funcao callback, se err existir, deu problema e é impresso no terminal
  db.query(sqlScripts, (err) => {
    if (err) console.error('Erro ao criar tabela scripts:', err);
  });

  db.query(sqlAmbientes, (err) => {
    if (err) console.error('Erro ao criar tabela ambientes:', err);
    else console.log('Banco de dados e tabelas verificados com sucesso!');
  });
};

inicializarBanco();

// funcao auxiliar para verificar no SO se o processo ainda esta rodando e atualizar o status
const verificarStatusProcesso = (ambiente) => {
  return new Promise((resolve) => {
    //se já está num estado final, não há o que verificar, apenas retorna o status
    if (ambiente.status === 'Terminado' || ambiente.status === 'Erro' || ambiente.status === 'Terminado (Forçado)') {
      return resolve(ambiente.status);
    }

    //se existe o arquivo de exit, significa que o script já terminou, então lê o exit code e atualiza o status no banco
    const exitFile = path.join(LOGS_DIR, `exit_${ambiente.nome_ambiente}.txt`);

    // se o arquivo de exit existe, o comando ja finalizou, atualiza o status no banco e retorna o status
    if (fs.existsSync(exitFile)) {
      const exitCode = parseInt(fs.readFileSync(exitFile, 'utf8').trim(), 10);
      const novoStatus = (exitCode === 0) ? 'Terminado' : 'Erro';
      db.query('UPDATE ambientes SET status = ? WHERE id = ?', [novoStatus, ambiente.id]);
      return resolve(novoStatus);
    }

    // verifica se o PID ainda existe na tabela de processos do Linux (ignorando processos zumbis)
    exec(`ps -p ${ambiente.pid} -o stat=`, (err, stdout) => {
      const stat = stdout ? stdout.trim() : '';
      if (err || !stat || stat.startsWith('Z')) {
        // processo nao existe mais; checa novamente se gerou arquivo de exit
        if (fs.existsSync(exitFile)) {
          const exitCode = parseInt(fs.readFileSync(exitFile, 'utf8').trim(), 10);
          const novoStatus = (exitCode === 0) ? 'Terminado' : 'Erro';
          db.query('UPDATE ambientes SET status = ? WHERE id = ?', [novoStatus, ambiente.id]);
          return resolve(novoStatus);
        } else {
          db.query('UPDATE ambientes SET status = ? WHERE id = ?', ['Terminado', ambiente.id]);
          return resolve('Terminado');
        }
      } else {
        return resolve('Em execução');
      }
    });
  });
};

// ROTAS DE SCRIPTS (Armazenamento para Reuso)

// cadastrar um novo script via formulario/JSON
app.post('/scripts', (req, res) => {
  const { nome, conteudo } = req.body;
  if (!nome || !conteudo) {
    return res.status(400).json({ erro: 'Os campos nome e conteudo sao obrigatorios.' });
  }

  // cria um nome de arquivo seguro, substituindo caracteres especiais e adicionando timestamp
  const nomeSeguro = nome.replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + Date.now() + '.sh';
  const caminhoArquivo = path.join(SCRIPTS_DIR, nomeSeguro);

  // converte quebras de linha do Windows (\r\n) para Linux (\n) e salva o arquivo
  const conteudoLimpo = conteudo.replace(/\r\n/g, '\n');

  try {
    fs.writeFileSync(caminhoArquivo, conteudoLimpo, { mode: 0o755 });
  } catch (err) {
    return res.status(500).json({ erro: 'Falha ao salvar script no disco.', detalhe: err.message });
  }

  //guarda o script no banco de dados para reuso futuro e gera um ID
  db.query(
    'INSERT INTO scripts (nome, conteudo, caminho_arquivo) VALUES (?, ?, ?)',
    [nome, conteudoLimpo, caminhoArquivo],
    (err, result) => {
      if (err) return res.status(500).json({ erro: 'Erro ao salvar script no banco.', detalhe: err.message });
      res.status(201).json({
        mensagem: 'Script salvo com sucesso para reuso!',
        id: result.insertId,
        nome,
        caminho_arquivo: caminhoArquivo
      });
    }
  );
});

// listar todos os scripts salvos para reuso
app.get('/scripts', (req, res) => {
  db.query('SELECT * FROM scripts ORDER BY id DESC', (err, results) => {
    if (err) return res.status(500).json({ erro: 'Erro ao buscar scripts.' });
    res.json(results);
  });
});

// ROTAS DE AMBIENTES (Namespaces / Cgroups / Execucao)

// criar e iniciar um novo ambiente de execucao
app.post('/ambientes', (req, res) => {
  //o usuario manda o nome, ou o ID de um script salvo, ou uma comando direto, mais os limites de CPU, RAM e IO
  const { nome_ambiente, script_id, comando_direto, limite_cpu, limite_ram, limite_io } = req.body;

  //limpa o nome do ambiente para evitar caracteres especiais e cria um nome unico com timestamp
  const nomeBase = nome_ambiente ? nome_ambiente.replace(/[^a-zA-Z0-9_-]/g, '_') : 'amb';
  const nomeUnico = `${nomeBase}_${Date.now()}`;

  const cpu = parseInt(limite_cpu, 10) || 50;           // Default: 50% de 1 core
  const ram = parseInt(limite_ram, 10) || 50000000;     // Default: ~50MB em bytes
  const io = parseInt(limite_io, 10) || 10485760;       // Default: 10MB/s em bytes

  // funcao auxiliar para disparar o motor.sh com os parametros corretos
  const dispararMotor = (comandoParaExecutar) => {
    const caminhoMotor = path.join(APP_DIR, 'motor.sh');
    const cmdEscapado = comandoParaExecutar.replace(/"/g, '\\"');
    const comandoCompleto = `sudo ${caminhoMotor} "${nomeUnico}" ${ram} ${cpu} ${io} "${cmdEscapado}"`;

    exec(comandoCompleto, (err, stdout, stderr) => {
      if (err) {
        return res.status(500).json({ erro: 'Falha ao executar motor.sh', detalhe: stderr || err.message });
      }

      // extrai o PID retornado pelo motor.sh (formato PID:1234)
      const match = stdout.match(/PID:(\d+)/);
      const pid = match ? parseInt(match[1], 10) : 0;
      const arquivoLog = path.join(LOGS_DIR, `saida_${nomeUnico}.txt`);

      db.query(
        `INSERT INTO ambientes (nome_ambiente, pid, comando, limite_cpu, limite_ram, limite_io, status, arquivo_log)
         VALUES (?, ?, ?, ?, ?, ?, 'Em execução', ?)`,
        [nomeUnico, pid, comandoParaExecutar, cpu, ram, io, arquivoLog],
        (dbErr, result) => {
          if (dbErr) {
            return res.status(500).json({ erro: 'Erro ao registrar ambiente no banco.', detalhe: dbErr.message });
          }
          res.status(201).json({
            mensagem: 'Ambiente criado e iniciado com sucesso!',
            id: result.insertId,
            nome_ambiente: nomeUnico,
            pid: pid,
            status: 'Em execução'
          });
        }
      );
    });
  };

  // verifica se o usuario escolheu um script salvo pelo ID ou mandou um comando direto
  if (script_id) {
    db.query('SELECT caminho_arquivo, conteudo FROM scripts WHERE id = ?', [script_id], (err, results) => {
      if (err || results.length === 0) {
        return res.status(404).json({ erro: 'Script salvo nao encontrado com o script_id informado.' });
      }
      const { caminho_arquivo, conteudo } = results[0];

      // se o arquivo fisico tiver sido apagado por um vagrant provision, recria-o a partir do MySQL
      if (!fs.existsSync(caminho_arquivo)) {
        fs.writeFileSync(caminho_arquivo, conteudo, { mode: 0o755 });
      }

      dispararMotor(caminho_arquivo);
    });
  } else if (comando_direto) {
    dispararMotor(comando_direto);
  } else {
    return res.status(400).json({ erro: 'Informe um script_id (salvo) ou um comando_direto para executar.' });
  }
});

// listar todos os ambientes e atualizar o status em tempo real
app.get('/ambientes', (req, res) => {
  db.query('SELECT * FROM ambientes ORDER BY id DESC', async (err, results) => {
    if (err) return res.status(500).json({ erro: 'Erro ao listar ambientes.' });

    for (let amb of results) {
      amb.status = await verificarStatusProcesso(amb);
    }

    res.json(results);
  });
});

// visualizar o output (arquivo de log) de um ambiente especifico
app.get('/ambientes/:id/output', (req, res) => {
  const { id } = req.params;
  db.query('SELECT * FROM ambientes WHERE id = ?', [id], async (err, results) => {
    if (err || results.length === 0) {
      return res.status(404).json({ erro: 'Ambiente nao encontrado.' });
    }

    const ambiente = results[0];
    const statusAtual = await verificarStatusProcesso(ambiente);

    let conteudoLog = '';
    if (fs.existsSync(ambiente.arquivo_log)) {
      conteudoLog = fs.readFileSync(ambiente.arquivo_log, 'utf8');
    } else {
      conteudoLog = '(Aguardando geracao de output...)';
    }

    res.json({
      id: ambiente.id,
      nome_ambiente: ambiente.nome_ambiente,
      pid: ambiente.pid,
      status: statusAtual,
      output: conteudoLog
    });
  });
});

// terminar/remover a execucao de um ambiente
app.delete('/ambientes/:id', (req, res) => {
  const { id } = req.params;
  const removerDoBanco = req.query.remover === 'true';

  db.query('SELECT * FROM ambientes WHERE id = ?', [id], (err, results) => {
    if (err || results.length === 0) {
      return res.status(404).json({ erro: 'Ambiente nao encontrado.' });
    }

    const amb = results[0];

    // Mata todos os processos dentro do Cgroup (v1 ou v2), mata recursivamente a arvore do PID e remove o Cgroup
    const cmdKill = `
      for f in /sys/fs/cgroup/memory/${amb.nome_ambiente}/cgroup.procs /sys/fs/cgroup/cpu/${amb.nome_ambiente}/cgroup.procs /sys/fs/cgroup/${amb.nome_ambiente}/cgroup.procs; do
        if [ -f "$f" ]; then
          for p in $(cat "$f"); do
            sudo kill -9 "$p" 2>/dev/null || true
          done
        fi
      done
      for child in $(pgrep -P ${amb.pid} 2>/dev/null); do
        sudo pkill -9 -P "$child" 2>/dev/null || true
        sudo kill -9 "$child" 2>/dev/null || true
      done
      sudo pkill -9 -P ${amb.pid} 2>/dev/null || true
      sudo kill -9 ${amb.pid} 2>/dev/null || true
      sudo cgdelete -r memory,cpu,blkio:/${amb.nome_ambiente} 2>/dev/null || true
    `;

    exec(cmdKill, () => {
      if (removerDoBanco) {
        db.query('DELETE FROM ambientes WHERE id = ?', [id], () => {
          res.json({ mensagem: `Ambiente ${amb.nome_ambiente} encerrado e removido da listagem!` });
        });
      } else {
        db.query('UPDATE ambientes SET status = ? WHERE id = ?', ['Terminado (Forçado)', id], () => {
          res.json({ mensagem: `Execucao do ambiente ${amb.nome_ambiente} (PID ${amb.pid}) encerrada com sucesso!` });
        });
      }
    });
  });
});

// inicializa o servidor Express na porta definida
app.listen(port, '0.0.0.0', () => {
  console.log(`API do Gerenciador de Ambientes rodando na porta ${port}`);
});