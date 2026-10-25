Vagrant.configure("2") do |config|
  is_arm = RUBY_PLATFORM.include?("arm64") || RUBY_PLATFORM.include?("aarch64")
  
  #cria a VM com o nome "servidor_projetocloud"
  config.vm.define "servidor_projetocloud" do |node|
    node.vm.box = "bento/ubuntu-22.04" if is_arm
    node.vm.box = "ubuntu/focal64" if !is_arm
    node.vm.box_architecture = "arm64" if is_arm
    node.vm.hostname = "nuvem-puc"
    
    #mapeia a porta 8080 do seu PC para o Nginx (porta 80) e 3000 para a API
    node.vm.network "forwarded_port", guest: 80, host: 8080
    node.vm.network "forwarded_port", guest: 3000, host: 3000
    
    node.vm.provider "virtualbox" do |vb|
      vb.gui = !is_arm
      #configura a memória e CPU da VM
      vb.memory = "4096" 
      vb.cpus = 1        
      vb.name = "vm_projeto2"
    end
    
    #provisionamento: instala TUDO de uma vez
    node.vm.provision "shell", inline: <<-SHELL
      #para atualizar os pacotes e instalar o Nginx, MySQL, Node.js, Git e Cgroup Tools
      echo "Atualizando pacotes..."
      export DEBIAN_FRONTEND=noninteractive
      apt-get update

      echo "Instalando Nginx, MySQL, Node.js, Git e Cgroup Tools..."
      apt-get install -y curl git nginx mysql-server cgroup-tools
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs

      echo "Baixando o código do Github..."
      rm -rf /home/vagrant/app
      git clone https://github.com/murilosf94/StonePediaTeste2.git /home/vagrant/app
      chown -R vagrant:vagrant /home/vagrant/app

      echo "Configurando Banco de Dados..."
      mysql -e "CREATE DATABASE IF NOT EXISTS gerenciador_processos;"
      mysql -e "CREATE USER IF NOT EXISTS 'api_user'@'localhost' IDENTIFIED BY 'senha_super_segura';"
      mysql -e "GRANT ALL PRIVILEGES ON gerenciador_processos.* TO 'api_user'@'localhost';"
      mysql -e "FLUSH PRIVILEGES;"

      chmod +x /home/vagrant/app/motor.sh #para garantir que o script seja executável
      
      echo "Ambiente montado!"
    SHELL
  end
end