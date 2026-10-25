Vagrant.configure("2") do |config|
	is_arm = RUBY_PLATFORM.include?("arm64") || RUBY_PLATFORM.include?("aarch64")
	
   # VM 1 - Proxy Reverso / Frontend
	config.vm.define "proxy" do |proxy|
		proxy.vm.box = "bento/ubuntu-22.04" if is_arm
		proxy.vm.box = "ubuntu/focal64" if !is_arm
		proxy.vm.box_architecture = "arm64" if is_arm
		proxy.vm.hostname = "proxy"
		
		#Mapeando a porta 8080 do Windows para a porta 80 da VM
		proxy.vm.network "forwarded_port", guest: 80, host: 8080
		
		proxy.vm.network "private_network", ip: "10.20.30.1", netmask: "255.255.255.0", virtualbox__intnet: "intnet"
		
        proxy.vm.provider "virtualbox" do |vb|
			vb.gui = !is_arm
			vb.memory = "1024"
			vb.cpus = 1
			vb.name = "proxy"
		end
		
		#NAT e NGINX
		proxy.vm.provision "shell", inline: <<-SHELL
			echo "Ativando IP Forwarding e Regra de NAT..."
			sysctl -w net.ipv4.ip_forward=1
			iptables -t nat -A POSTROUTING -s 10.20.30.0/24 -o enp0s3 -j MASQUERADE

			echo "Atualizando pacotes e instalando NGINX..."
			export DEBIAN_FRONTEND=noninteractive
			apt-get update
			apt-get install -y nginx

			echo "Configurando o Proxy Reverso..."
			cat << 'EOF' > /etc/nginx/sites-available/default
server {
    listen 80 default_server;
    
    location / {
        # Encaminha o trafego para o App Server na porta 3000
        proxy_pass http://10.20.30.2:3000;
    }
}
EOF
			
			echo "Reiniciando o NGINX para aplicar as mudancas..."
			systemctl restart nginx
		SHELL
	end

	# VM 3 - Banco de Dados
    config.vm.define "db" do |db|
		db.vm.box = "bento/ubuntu-22.04" if is_arm
		db.vm.box = "ubuntu/focal64" if !is_arm
		db.vm.box_architecture = "arm64" if is_arm
		db.vm.hostname = "db"
		
		db.vm.network "private_network", ip: "10.20.30.3", netmask: "255.255.255.0", virtualbox__intnet: "intnet"
		
        db.vm.provider "virtualbox" do |vb|
			vb.gui = !is_arm
			vb.memory = "1024"
			vb.cpus = 1
			vb.name = "db"
		end
		
		#Rota, DNS e Instalação do MySQL
		db.vm.provision "shell", inline: <<-SHELL
			echo "Configurando Gateway padrao para 10.20.30.1..."
			ip route replace default via 10.20.30.1
			echo "nameserver 8.8.8.8" > /etc/resolv.conf
			
			echo "Atualizando pacotes e instalando MySQL..."
			export DEBIAN_FRONTEND=noninteractive
			apt-get update
			apt-get install -y mysql-server
			
			echo "Configurando o MySQL para aceitar conexões da rede interna..."
			# Altera o bind-address de 127.0.0.1 para 0.0.0.0 (aceita qualquer IP)
			sed -i 's/bind-address.*/bind-address = 0.0.0.0/' /etc/mysql/mysql.conf.d/mysqld.cnf
			systemctl restart mysql
			
			echo "Criando banco de dados das pedras preciosas e usuario para a API..."
			mysql -e "CREATE DATABASE IF NOT EXISTS pedras_preciosas;"
			mysql -e "CREATE USER IF NOT EXISTS 'api_user'@'10.20.30.2' IDENTIFIED BY 'senha_super_segura';"
			mysql -e "GRANT ALL PRIVILEGES ON pedras_preciosas.* TO 'api_user'@'10.20.30.2';"
			mysql -e "FLUSH PRIVILEGES;"
		SHELL
	end

    # VM 2 - App Server / API Gateway
	config.vm.define "appserver" do |app|
		app.vm.box = "bento/ubuntu-22.04" if is_arm
		app.vm.box = "ubuntu/focal64" if !is_arm
		app.vm.box_architecture = "arm64" if is_arm
		app.vm.hostname = "appserver"
		
		app.vm.network "private_network", ip: "10.20.30.2", netmask: "255.255.255.0", virtualbox__intnet: "intnet"
		
        app.vm.provider "virtualbox" do |vb|
			vb.gui = !is_arm
			vb.memory = "1024"
			vb.cpus = 1
			vb.name = "appserver"
		end
		
		#Rota, DNS, Node.js v20 e API com Visual
		app.vm.provision "shell", inline: <<-SHELL
			echo "Configurando Gateway padrao para 10.20.30.1..."
			ip route replace default via 10.20.30.1
			echo "nameserver 8.8.8.8" > /etc/resolv.conf

			echo "Baixando e Instalando Node.js v20..."
			export DEBIAN_FRONTEND=noninteractive
			apt-get update
			apt-get install -y curl
			curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
			apt-get install -y nodejs

			echo "Criando o diretorio da API..."
			mkdir -p /home/vagrant/api
			cd /home/vagrant/api

			echo "Iniciando projeto Node e instalando dependencias (Express e MySQL)..."
			npm init -y
			npm install express mysql2

			echo "Criando o codigo fonte da API (index.js)..."
			cat << 'EOF' > index.js
const express = require('express');
const mysql = require('mysql2');
const app = express();
const port = 3000;

// Permite que o Express entenda requisições com corpo em JSON
app.use(express.json());

const db = mysql.createConnection({
  host: '10.20.30.3',
  user: 'api_user',
  password: 'senha_super_segura',
  database: 'pedras_preciosas'
});

db.connect((err) => {
  if (err) {
    console.error('Erro ao conectar no banco:', err);
  } else {
    console.log('Conectado ao MySQL com sucesso!');
    db.query("CREATE TABLE IF NOT EXISTS gemas (id INT AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(50), cor VARCHAR(50));");
    db.query("INSERT IGNORE INTO gemas (id, nome, cor) VALUES (1, 'Rubi', 'Vermelho'), (2, 'Esmeralda', 'Verde');");
  }
});

// ROTA GET: Listar via JSON
app.get('/gemas', (req, res) => {
  db.query('SELECT * FROM gemas', (err, results) => {
    if (err) res.status(500).send("Erro no banco de dados.");
    else res.json(results);
  });
});

// ROTA POST: Inserir nova gema
app.post('/gemas', (req, res) => {
  const { nome, cor } = req.body;
  db.query('INSERT INTO gemas (nome, cor) VALUES (?, ?)', [nome, cor], (err, results) => {
    if (err) res.status(500).send("Erro ao inserir.");
    else res.status(201).send("Gema inserida com sucesso!");
  });
});

// ROTA DELETE: Deletar gema pelo ID
app.delete('/gemas/:id', (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM gemas WHERE id = ?', [id], (err, results) => {
    if (err) res.status(500).send("Erro ao deletar.");
    else res.status(200).send("Gema deletada com sucesso!");
  });
});

// ROTA GET: Visualizacao em Tabela HTML/CSS com Formulário
app.get('/tabela', (req, res) => {
  db.query('SELECT * FROM gemas', (err, results) => {
    if (err) {
      res.status(500).send("Erro no banco de dados.");
    } else {
      let html = `
        <!DOCTYPE html>
        <html lang="pt-br">
        <head>
          <meta charset="UTF-8">
          <title>StonePedia</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; color: #333; text-align: center; padding: 20px; }
            h1 { color: #2c3e50; }
            .container { width: 60%; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); margin-bottom: 20px; }
            input, button { padding: 10px; margin: 5px; border-radius: 4px; border: 1px solid #ddd; }
            button { background-color: #3498db; color: white; border: none; cursor: pointer; }
            button.delete-btn { background-color: #e74c3c; padding: 5px 10px; }
            table { margin: 0 auto; border-collapse: collapse; width: 100%; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #3498db; color: white; text-transform: uppercase; }
          </style>
        </head>
        <body>
          <h1>StonePedia</h1>
          
          <div class="container">
            <h3>Adicionar Nova Gema</h3>
            <form onsubmit="adicionarGema(event)">
              <input type="text" id="nome" placeholder="Nome da Gema" required>
              <input type="text" id="cor" placeholder="Cor" required>
              <button type="submit">Inserir</button>
            </form>
          </div>

          <div class="container">
            <table>
              <tr><th>ID</th><th>Nome da Gema</th><th>Cor Predominante</th><th>Ações</th></tr>
      `;
      
      results.forEach(gema => {
        html += `<tr>
                  <td>${gema.id}</td>
                  <td><strong>${gema.nome}</strong></td>
                  <td>${gema.cor}</td>
                  <td><button class="delete-btn" onclick="deletarGema(${gema.id})">Excluir</button></td>
                 </tr>`;
      });

      html += `
            </table>
          </div>

          <script>
            function adicionarGema(event) {
              event.preventDefault();
              const nome = document.getElementById('nome').value;
              const cor = document.getElementById('cor').value;
              
              fetch('/gemas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome, cor })
              }).then(() => window.location.reload());
            }

            function deletarGema(id) {
              if(confirm('Tem certeza que deseja excluir esta gema?')) {
                fetch('/gemas/' + id, { method: 'DELETE' })
                  .then(() => window.location.reload());
              }
            }
          </script>
        </body>
        </html>
      `;
      res.send(html);
    }
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`API rodando na porta ${port}`);
});
EOF
			
			echo "Ajustando permissoes dos arquivos..."
			chown -R vagrant:vagrant /home/vagrant/api

			echo "Iniciando a API em background..."
			echo "Criando serviço Systemd para a API rodar no boot..."
			cat << 'EOF' > /etc/systemd/system/stonepedia.service
[Unit]
Description=API StonePedia Node.js
After=network.target

[Service]
Type=simple
User=vagrant
WorkingDirectory=/home/vagrant/api
ExecStart=/usr/bin/node /home/vagrant/api/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

			echo "Iniciando e habilitando a API..."
			systemctl daemon-reload
			systemctl enable stonepedia
			systemctl restart stonepedia
		SHELL
	end
end