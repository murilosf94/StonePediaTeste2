Vagrant.configure("2") do |config|
  is_arm = RUBY_PLATFORM.include?("arm64") || RUBY_PLATFORM.include?("aarch64")

  #configuracoes gerais da VM
  config.vm.define "servidor_projetocloud" do |node|
    node.vm.box = "bento/ubuntu-22.04" if is_arm
    node.vm.box = "ubuntu/focal64" if !is_arm
    node.vm.box_architecture = "arm64" if is_arm
    node.vm.hostname = "nuvem-puc"

    #redes e portas
    node.vm.network "forwarded_port", guest: 80, host: 8080
    node.vm.network "forwarded_port", guest: 3000, host: 3000

    node.vm.provider "virtualbox" do |vb|
      vb.gui = !is_arm
      vb.memory = "4096" #4096 MB de RAM
      vb.cpus = 1 #1 CPU
      vb.name = "vm_projeto2"
    end

    node.vm.provision "shell", inline: <<-SHELL
      echo "Atualizando pacotes..."
      export DEBIAN_FRONTEND=noninteractive # Desativa a interatividade do apt-get
      apt-get update #atualiza o catalogo de programas do ubuntu

      echo "Instalando Nginx, MySQL, Node.js, Git e Cgroup Tools..."
      apt-get install -y curl git nginx mysql-server cgroup-tools #responde yes para tudo e aqui instalamos os pilares do projeto (git, nginx, mysql, nodejs e cgroup-tools)
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs

      echo "Clonando o repositorio do GitHub..."
      rm -rf /home/vagrant/app #em caso de provisionamento anterior, remove a pasta app para evitar conflitos
      git clone https://github.com/murilosf94/StonePediaTeste2.git /home/vagrant/app #git clone do repositorio do projeto para a pasta /home/vagrant/app

      mkdir -p /home/vagrant/app/logs #cria a pasta de logs caso nao exista
      mkdir -p /home/vagrant/app/scripts #cria a pasta de scripts caso nao exista
      sed -i 's/\r$//' /home/vagrant/app/motor.sh #remove o \r do final das linhas do script motor.sh para evitar problemas de execução
      chmod +x /home/vagrant/app/motor.sh #torna o script motor.sh executável
      chown -R vagrant:vagrant /home/vagrant/app #garante que o usuário vagrant seja o dono da pasta /home/vagrant/app e de todos os seus arquivos

      #cria o mysql que fica rodando na porta 3306 e cria o banco de dados gerenciador_processos e o usuario api_user com senha senha_super_segura
      #banco para armazenar os processos que estao rodando na VM e o usuario para a API acessar o banco de dados
      echo "Configurando Banco de Dados MySQL..."
      mysql -e "CREATE DATABASE IF NOT EXISTS gerenciador_processos;"
      mysql -e "CREATE USER IF NOT EXISTS 'api_user'@'localhost' IDENTIFIED BY 'senha_super_segura';"
      mysql -e "GRANT ALL PRIVILEGES ON gerenciador_processos.* TO 'api_user'@'localhost';"
      mysql -e "FLUSH PRIVILEGES;"

      echo "Instalando pacotes do Node.js..."
      cd /home/vagrant/app
      sudo -u vagrant npm install #instala os pacotes do Node.js listados no package.json

      #proxy reverso do nginx para a API Node.js que roda na porta 3000
      echo "Configurando Proxy Reverso no Nginx..."
      cat << 'EOF' > /etc/nginx/sites-available/default
server {
    listen 80 default_server;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF
      systemctl restart nginx

      echo "Configurando servico Systemd para a API Node.js..."
      cat << 'EOF' > /etc/systemd/system/gerenciador.service #registra a API Node.js como um serviço do Systemd para iniciar automaticamente na inicialização da VM
[Unit]
Description=API Gerenciador de Ambientes Cloud
After=network.target mysql.service 

[Service]
Type=simple
User=vagrant
WorkingDirectory=/home/vagrant/app
ExecStart=/usr/bin/node /home/vagrant/app/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

      systemctl daemon-reload #avisa o linux que criamos um arquivo de serviço novo
      systemctl enable gerenciador #habilita o serviço para iniciar automaticamente na inicialização da VM
      systemctl restart gerenciador #inicia o serviço da API Node.js

      echo "Provisionamento completo! API rodando na porta 3000 e Nginx na porta 80."
    SHELL
  end
end