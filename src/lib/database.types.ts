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
      chore_overrides: {
        Row: {
          id: string
          chore_id: string
          original_date: string
          is_skipped: boolean
          new_assignee_id: string | null
          new_date: string | null
          created_at: string
        }
        Insert: {
          id?: string
          chore_id: string
          original_date: string
          is_skipped?: boolean
          new_assignee_id?: string | null
          new_date?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          chore_id?: string
          original_date?: string
          is_skipped?: boolean
          new_assignee_id?: string | null
          new_date?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chore_overrides_chore_id_fkey"
            columns: ["chore_id"]
            referencedRelation: "chores"
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
      chores: {
        Row: {
          id: string
          household_id: string
          title: string
          description: string | null
          zone: string | null
          frequency_days: number
          start_date: string
          end_date: string | null
          assignment_strategy: 'none' | 'fixed' | 'rotation'
          fixed_assignee_id: string | null
          rotation_sequence: string[] | null
          rotation_interval_days: number
          archived: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          household_id: string
          title: string
          description?: string | null
          zone?: string | null
          frequency_days?: number
          start_date?: string
          end_date?: string | null
          assignment_strategy?: 'none' | 'fixed' | 'rotation'
          fixed_assignee_id?: string | null
          rotation_sequence?: string[] | null
          rotation_interval_days?: number
          archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          title?: string
          description?: string | null
          zone?: string | null
          frequency_days?: number
          start_date?: string
          end_date?: string | null
          assignment_strategy?: 'none' | 'fixed' | 'rotation'
          fixed_assignee_id?: string | null
          rotation_sequence?: string[] | null
          rotation_interval_days?: number
          archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chores_household_id_fkey"
            columns: ["household_id"]
            referencedRelation: "households"
            referencedColumns: ["id"]
          }
        ]
      }
      chore_completions: {
        Row: {
          id: string
          chore_id: string
          completed_at: string
          completed_by: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          chore_id: string
          completed_at?: string
          completed_by?: string | null
          notes?: string | null
        }
        Update: {
          id?: string
          chore_id?: string
          completed_at?: string
          completed_by?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chore_completions_chore_id_fkey"
            columns: ["chore_id"]
            referencedRelation: "chores"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
        get_member_emails: {
          Args: {
            p_user_ids: string[]
          }
          Returns: {
            user_id: string
            email: string | null
          }[]
        }
        delete_household: {
          Args: {
            p_household_id: string
          }
          Returns: void
        }
        create_household: {
          Args: {
            p_name: string
          }
          Returns: unknown
        }
        request_join_by_code: {
          Args: {
            p_join_code: string
            p_message: string | null
          }
          Returns: unknown
        }
        accept_household_invite: {
          Args: {
            p_token: string
          }
          Returns: unknown
        }
      }
    Enums: {
      [_ in never]: never
    }
  }
}
