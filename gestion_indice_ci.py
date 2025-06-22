name: Actualizar índice de cámara

on:
  workflow_dispatch:
    inputs:
      loc:
        required: true
      can:
        required: true
      lado:
        required: true

jobs:
  actualizar_json:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Instalar Rclone
        run: sudo apt-get install rclone -y

      - name: Ejecutar script
        run: python gestion_indice_ci.py --loc ${{ github.event.inputs.loc }} --can ${{ github.event.inputs.can }} --lado ${{ github.event.inputs.lado }}
