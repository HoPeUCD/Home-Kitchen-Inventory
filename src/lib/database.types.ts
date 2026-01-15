export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          user_id: string
          default_household_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          default_household_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          default_household_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_household_id_fkey"
            columns: ["default_household_id"]
            referencedRelation: "households"
            referencedColumns: ["id"]
          }
        ]
      }
      households: {
        Row: {
          id: string
          name: string
          join_code: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          join_code?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          join_code?: string | null
          created_at?: string
        }
        Relationships: []
      }
      household_members: {
        Row: {
          household_id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: {
          household_id: string
          user_id: string
          role: string
          created_at?: string
        }
        Update: {
          household_id?: string
          user_id?: string
          role?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            referencedRelation: "households"
            referencedColumns: ["id"]
          }
        ]
      }
      rooms: {
        Row: {
          id: string
          household_id: string
          name: string
          position: number | null
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          name: string
          position?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          name?: string
          position?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_household_id_fkey"
            columns: ["household_id"]
            referencedRelation: "households"
            referencedColumns: ["id"]
          }
        ]
      }
      room_columns: {
        Row: {
          id: string
          room_id: string
          name: string
          position: number | null
          created_at: string
        }
        Insert: {
          id?: string
          room_id: string
          name: string
          position?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          room_id?: string
          name?: string
          position?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_columns_room_id_fkey"
            columns: ["room_id"]
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          }
        ]
      }
      room_cells: {
        Row: {
          id: string
          column_id: string
          code: string
          position: number | null
          created_at: string
        }
        Insert: {
          id?: string
          column_id: string
          code: string
          position?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          column_id?: string
          code?: string
          position?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_cells_column_id_fkey"
            columns: ["column_id"]
            referencedRelation: "room_columns"
            referencedColumns: ["id"]
          }
        ]
      }
      items_v2: {
        Row: {
          id: string
          household_id: string
          cell_id: string
          name: string
          qty: number | null
          expires_at: string | null
          image_path: string | null
          remark: string | null
          tag: string | null
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          cell_id: string
          name: string
          qty?: number | null
          expires_at?: string | null
          image_path?: string | null
          remark?: string | null
          tag?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          cell_id?: string
          name?: string
          qty?: number | null
          expires_at?: string | null
          image_path?: string | null
          remark?: string | null
          tag?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_v2_household_id_fkey"
            columns: ["household_id"]
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_v2_cell_id_fkey"
            columns: ["cell_id"]
            referencedRelation: "room_cells"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
