import json
import os

CONFIG_PATH = "data/config_locations.json"

def cargar_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def guardar_config(data):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def agregar_lado(club_id, club_nombre, cancha_id, cancha_nombre, lado_id, lado_nombre):
    data = cargar_config()

    # Buscar club
    club = next((c for c in data["locaciones"] if c["id"] == club_id), None)
    if not club:
        print(f"➕ Agregando nuevo club: {club_nombre}")
        club = {
            "id": club_id,
            "nombre": club_nombre,
            "cancha": []
        }
        data["locaciones"].append(club)
    
    # Buscar cancha
    cancha = next((c for c in club["cancha"] if c["id"] == cancha_id), None)
    if not cancha:
        print(f"➕ Agregando nueva cancha: {cancha_nombre}")
        cancha = {
            "id": cancha_id,
            "nombre": cancha_nombre,
            "lados": []
        }
        club["cancha"].append(cancha)
    
    # Verificar lado
    if lado_id not in cancha["lados"]:
        print(f"➕ Agregando lado: {lado_nombre}")
        cancha["lados"].append(lado_id)
    else:
        print("✅ El lado ya existe. No se hace nada.")

    guardar_config(data)
    print("✅ Configuración actualizada exitosamente.")

if __name__ == "__main__":
    print("Agregar nuevo lado al sistema Puntazo")
    club_id = input("ID del Club (ej. ClubEjemplo): ")
    club_nombre = input("Nombre del Club (ej. Club Ejemplo): ")
    cancha_id = input("ID de la Cancha (ej. Cancha1): ")
    cancha_nombre = input("Nombre de la Cancha (ej. Cancha 1): ")
    lado_id = input("ID del Lado (ej. LadoA): ")
    lado_nombre = input("Nombre del Lado (ej. Lado A): ")
    
    agregar_lado(club_id, club_nombre, cancha_id, cancha_nombre, lado_id, lado_nombre)
