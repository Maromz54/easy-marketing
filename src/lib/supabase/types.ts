/**
 * TypeScript types matching the database schema.
 * In production, replace with: npx supabase gen types typescript --project-id YOUR_ID
 *
 * Updated for @supabase/supabase-js v2.99+ which requires a Relationships array
 * and the new generic structure.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      facebook_tokens: {
        Row: {
          id: string;
          user_id: string;
          page_id: string;
          page_name: string | null;
          access_token: string;
          token_expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          page_id: string;
          page_name?: string | null;
          access_token: string;
          token_expires_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          page_id?: string;
          page_name?: string | null;
          access_token?: string;
          token_expires_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "facebook_tokens_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      posts: {
        Row: {
          id: string;
          user_id: string;
          facebook_token_id: string | null;
          content: string;
          image_url: string | null;
          link_url: string | null;
          target_id: string | null;
          status: "draft" | "scheduled" | "published" | "failed";
          scheduled_at: string | null;
          published_at: string | null;
          facebook_post_id: string | null;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          facebook_token_id?: string | null;
          content: string;
          image_url?: string | null;
          link_url?: string | null;
          target_id?: string | null;
          status?: "draft" | "scheduled" | "published" | "failed";
          scheduled_at?: string | null;
          published_at?: string | null;
          facebook_post_id?: string | null;
          error_message?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          facebook_token_id?: string | null;
          content?: string;
          image_url?: string | null;
          link_url?: string | null;
          target_id?: string | null;
          status?: "draft" | "scheduled" | "published" | "failed";
          scheduled_at?: string | null;
          published_at?: string | null;
          facebook_post_id?: string | null;
          error_message?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "posts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "posts_facebook_token_id_fkey";
            columns: ["facebook_token_id"];
            isOneToOne: false;
            referencedRelation: "facebook_tokens";
            referencedColumns: ["id"];
          }
        ];
      };
      links: {
        Row: {
          id: string;
          user_id: string;
          slug: string;
          destination: string;
          label: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          slug: string;
          destination: string;
          label?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          slug?: string;
          destination?: string;
          label?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "links_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      link_clicks: {
        Row: {
          id: string;
          link_id: string;
          clicked_at: string;
          ip_hash: string | null;
          user_agent: string | null;
          country: string | null;
        };
        Insert: {
          id?: string;
          link_id: string;
          clicked_at?: string;
          ip_hash?: string | null;
          user_agent?: string | null;
          country?: string | null;
        };
        Update: {
          id?: string;
          link_id?: string;
          clicked_at?: string;
          ip_hash?: string | null;
          user_agent?: string | null;
          country?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "link_clicks_link_id_fkey";
            columns: ["link_id"];
            isOneToOne: false;
            referencedRelation: "links";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      post_status: "draft" | "scheduled" | "published" | "failed";
    };
    CompositeTypes: Record<string, never>;
  };
};
