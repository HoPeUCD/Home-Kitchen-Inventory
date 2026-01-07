import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const openaiApiKey = process.env.OPENAI_API_KEY;

export async function POST(req: NextRequest) {
  try {
    // Check if OpenAI API key is configured
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key is not configured' },
        { status: 500 }
      );
    }

    const { householdId, question, conversationHistory } = await req.json();

    if (!householdId || !question) {
      return NextResponse.json(
        { error: 'householdId and question are required' },
        { status: 400 }
      );
    }

    // Get auth token from request
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Authorization header required' },
        { status: 401 }
      );
    }

    // Create authenticated Supabase client with user's access token
    const token = authHeader.replace('Bearer ', '');
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    // Load all rooms for this household
    const { data: roomsData, error: roomsErr } = await supabaseAuth
      .from('rooms')
      .select('id, name, position')
      .eq('household_id', householdId)
      .order('position', { ascending: true });

    if (roomsErr) throw roomsErr;
    if (!roomsData || roomsData.length === 0) {
      return NextResponse.json({
        response: 'This household has no rooms yet. Please add some items first.',
      });
    }

    const roomIds = roomsData.map(r => r.id);

    // Load all columns
    const { data: columnsData, error: columnsErr } = await supabaseAuth
      .from('room_columns')
      .select('id, room_id, name, position')
      .in('room_id', roomIds)
      .order('position', { ascending: true });

    if (columnsErr) throw columnsErr;

    const columnIds = columnsData?.map(c => c.id) ?? [];
    const columnById = new Map(columnsData?.map(c => [c.id, c]) ?? []);

    // Load all cells
    const { data: cellsData, error: cellsErr } = await supabaseAuth
      .from('room_cells')
      .select('id, column_id, code, position')
      .in('column_id', columnIds)
      .order('position', { ascending: true });

    if (cellsErr) throw cellsErr;

    const cellIds = cellsData?.map(c => c.id) ?? [];
    const cellById = new Map(cellsData?.map(c => [c.id, c]) ?? []);

    // Load all items
    const { data: itemsData, error: itemsErr } = await supabaseAuth
      .from('items_v2')
      .select('id, cell_id, name, qty, expires_at, remark')
      .eq('household_id', householdId)
      .in('cell_id', cellIds);

    if (itemsErr) throw itemsErr;

    // Build room -> column -> cell mapping
    const roomToColumns = new Map<string, typeof columnsData>();
    const columnToCells = new Map<string, typeof cellsData>();

    columnsData?.forEach(col => {
      if (!roomToColumns.has(col.room_id)) {
        roomToColumns.set(col.room_id, []);
      }
      roomToColumns.get(col.room_id)!.push(col);
    });

    cellsData?.forEach(cell => {
      const col = columnById.get(cell.column_id);
      if (col) {
        if (!columnToCells.has(cell.column_id)) {
          columnToCells.set(cell.column_id, []);
        }
        columnToCells.get(cell.column_id)!.push(cell);
      }
    });

    // Build inventory data table (similar to Excel export) and store item IDs for operations
    const inventoryData: Array<{
      Room: string;
      Column: string;
      Cell: string;
      'Item Name': string;
      'Quantity': number | null;
      'Expire Date': string | null;
      'Remark': string;
      'Location': string;
      'Item ID': string; // Store item ID for operations
    }> = [];
    
    // Map to store item IDs by name and location for quick lookup
    const itemIdMap = new Map<string, string[]>(); // itemName -> itemIds[]
    
    // Build location to cell_id mapping for adding items
    // Format: "Room / Column / Cell" -> cell_id
    const locationToCellId = new Map<string, string>();
    // Also build room/column/cell name mappings for flexible matching
    const roomNameToId = new Map<string, string>();
    const columnNameToId = new Map<string, string>();
    const cellCodeToId = new Map<string, string>();
    
    roomsData.forEach(room => {
      roomNameToId.set(room.name.toLowerCase().trim(), room.id);
    });
    
    columnsData?.forEach(col => {
      columnNameToId.set(col.name.toLowerCase().trim(), col.id);
    });
    
    cellsData?.forEach(cell => {
      cellCodeToId.set(cell.code.toLowerCase().trim(), cell.id);
    });

    const sortedRooms = [...roomsData].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    sortedRooms.forEach(room => {
      const columns = roomToColumns.get(room.id) ?? [];
      const sortedColumns = columns.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

      sortedColumns.forEach(column => {
        const cells = columnToCells.get(column.id) ?? [];
        const sortedCells = cells.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

        sortedCells.forEach(cell => {
          const location = `${room.name} / ${column.name} / ${cell.code}`;
          // Build location to cell_id mapping
          locationToCellId.set(location.toLowerCase(), cell.id);
          
          const items = itemsData?.filter(item => item.cell_id === cell.id) ?? [];

          items.forEach(item => {
            inventoryData.push({
              Room: room.name,
              Column: column.name,
              Cell: cell.code,
              'Item Name': item.name,
              'Quantity': item.qty,
              'Expire Date': item.expires_at ? new Date(item.expires_at + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '',
              'Remark': item.remark ?? '',
              'Location': location,
              'Item ID': item.id,
            });
            
            // Build item ID map for quick lookup (case-insensitive)
            const itemKey = item.name.toLowerCase().trim();
            if (!itemIdMap.has(itemKey)) {
              itemIdMap.set(itemKey, []);
            }
            itemIdMap.get(itemKey)!.push(item.id);
          });
        });
      });
    });

    // Format inventory data as text for ChatGPT (without Item ID in display)
    let inventoryTextDisplay = 'Inventory Data:\n\n';
    if (inventoryData.length === 0) {
      inventoryTextDisplay += 'No items found in this household.\n';
    } else {
      // Header (without Item ID)
      inventoryTextDisplay += 'Room | Column | Cell | Item Name | Quantity | Expire Date | Remark | Location\n';
      inventoryTextDisplay += '-'.repeat(100) + '\n';
      
      // Data rows (without Item ID)
      inventoryData.forEach(item => {
        inventoryTextDisplay += `${item.Room} | ${item.Column} | ${item.Cell} | ${item['Item Name']} | ${item.Quantity ?? 'N/A'} | ${item['Expire Date'] || 'N/A'} | ${item.Remark || 'N/A'} | ${item.Location}\n`;
      });
      
      inventoryTextDisplay += `\nTotal items: ${inventoryData.length}\n`;
    }
    
    // Build list of all available locations for reference
    const allLocations = new Set<string>();
    sortedRooms.forEach(room => {
      const columns = roomToColumns.get(room.id) ?? [];
      const sortedCols = columns.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      
      sortedCols.forEach(column => {
        const cells = columnToCells.get(column.id) ?? [];
        const sortedCellsForLoc = cells.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        
        sortedCellsForLoc.forEach(cell => {
          allLocations.add(`${room.name} / ${column.name} / ${cell.code}`);
        });
      });
    });
    
    let availableLocationsText = '\nAvailable Locations (for adding new items):\n';
    if (allLocations.size === 0) {
      availableLocationsText += 'No locations available. Please create rooms, columns, and cells first.\n';
    } else {
      Array.from(allLocations).sort().forEach(loc => {
        availableLocationsText += `- ${loc}\n`;
      });
    }
    
    inventoryTextDisplay += availableLocationsText;

    // Build messages for ChatGPT
    const systemMessage = {
      role: 'system' as const,
      content: `You are a helpful assistant that answers questions about kitchen inventory data and can help manage the inventory. 

CRITICAL RULES - YOU MUST FOLLOW THESE STRICTLY:

1. **DATA VERIFICATION**: You can ONLY use information from the inventory data provided below. You MUST verify that an item exists in the data before saying it exists. If an item is NOT in the inventory data, you MUST explicitly state "I don't have [item name] in my inventory" or "There is no [item name] in the inventory".

2. **NO ASSUMPTIONS**: Never assume or make up items that are not in the inventory data. If the user asks about an item that doesn't exist, you MUST say it doesn't exist.

3. **ANSWER FORMAT**: When listing items, you MUST include: Item Name, Quantity, and Location (in the format "Room / Column / Cell") for each item.

4. **RECIPE QUESTIONS**: When asked about recipes or cooking (e.g., "Can I make X?"), you MUST check the inventory data first. List only the ingredients that actually exist in the inventory with their names, quantities, and locations. If any required ingredient is missing, explicitly state which ingredients are missing.

5. **DELETION OPERATIONS**: You can help the user delete items from the inventory when they ask (e.g., "delete eggs", "remove all milk", "get rid of expired items"). When the user wants to delete items, respond with a JSON object in this exact format:
{"action": "delete", "items": ["Item Name 1", "Item Name 2"], "reason": "brief explanation"}

If multiple items with the same name exist in different locations, delete ALL of them unless the user specifies a location.

6. **ADD ITEM OPERATIONS**: You can help the user add new items to the inventory when they ask (e.g., "add 3 eggs", "I just bought 2 bottles of milk"). 

CRITICAL: If the user wants to add an item but does NOT specify a location, you MUST NOT respond with a JSON action. Instead, ask the user where they want to place the item. Provide them with a list of available locations in the format "Room / Column / Cell" from the inventory data above.

When the user provides a location AND wants to add items, respond with a JSON object in this exact format:
{"action": "add", "items": [{"name": "Item Name", "qty": 1, "location": "Room / Column / Cell", "remark": "optional note"}], "reason": "brief explanation"}

IMPORTANT for adding items:
- "qty" must be a number >= 1 (default to 1 if not specified)
- "location" must be in the format "Room / Column / Cell" exactly as shown in the inventory data
- You CANNOT add items without a location specified by the user
- "remark" is optional

Inventory Data:

${inventoryData.length === 0 ? 'NO ITEMS FOUND IN INVENTORY' : inventoryTextDisplay}

Remember: If an item is not in the inventory data above, you CANNOT say it exists. Always verify against the data first.`,
    };

    // Build conversation history (user messages and assistant responses)
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [systemMessage];
    
    // Add conversation history if provided
    if (conversationHistory && Array.isArray(conversationHistory)) {
      conversationHistory.forEach((msg: { role: string; content: string }) => {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
          });
        }
      });
    }

    // Add current question
    messages.push({
      role: 'user',
      content: question,
    });

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.7,
        max_tokens: 1500,
        response_format: { type: 'text' }, // Allow both JSON and text responses
      }),
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json().catch(() => ({}));
      throw new Error(`OpenAI API error: ${errorData.error?.message || openaiResponse.statusText}`);
    }

    const openaiData = await openaiResponse.json();
    let response = openaiData.choices[0]?.message?.content || 'No response from AI';
    
    // Check if response contains an action (delete or add)
    let operationResult = null;
    try {
      // Try to extract JSON from response (might be wrapped in text)
      const jsonMatch = response.match(/\{[\s\S]*"action"[\s\S]*\}/);
      if (jsonMatch) {
        const actionData = JSON.parse(jsonMatch[0]);
        
        // Handle delete action
        if (actionData.action === 'delete' && Array.isArray(actionData.items)) {
          // Find item IDs to delete
          const itemIdsToDelete: string[] = [];
          const deletedItems: string[] = [];
          
          actionData.items.forEach((itemName: string) => {
            const itemKey = itemName.toLowerCase().trim();
            const itemIds = itemIdMap.get(itemKey);
            if (itemIds && itemIds.length > 0) {
              itemIdsToDelete.push(...itemIds);
              deletedItems.push(itemName);
            }
          });
          
          if (itemIdsToDelete.length > 0) {
            // Execute delete operation
            const { error: deleteError } = await supabaseAuth
              .from('items_v2')
              .delete()
              .in('id', itemIdsToDelete);
            
            if (deleteError) {
              operationResult = {
                success: false,
                message: `Failed to delete items: ${deleteError.message}`,
              };
            } else {
              operationResult = {
                success: true,
                action: 'delete',
                count: itemIdsToDelete.length,
                items: deletedItems,
                message: `Successfully deleted ${itemIdsToDelete.length} item(s): ${deletedItems.join(', ')}`,
              };
              
              // Update response to include operation result
              response = `${actionData.reason || 'Items deleted'}. ${operationResult.message}`;
            }
          } else {
            operationResult = {
              success: false,
              message: `No items found matching: ${actionData.items.join(', ')}`,
            };
            response = `I couldn't find any items matching: ${actionData.items.join(', ')}. Please check the item names and try again.`;
          }
        }
        
        // Handle add action
        else if (actionData.action === 'add' && Array.isArray(actionData.items)) {
          const addedItems: Array<{name: string; location: string}> = [];
          const failedItems: Array<{name: string; reason: string}> = [];
          
          for (const item of actionData.items) {
            if (!item.name || typeof item.name !== 'string') {
              failedItems.push({ name: item.name || 'Unknown', reason: 'Invalid item name' });
              continue;
            }
            
            // Require location for add operations
            if (!item.location || typeof item.location !== 'string') {
              failedItems.push({ name: item.name, reason: 'Location is required. Please specify a location in the format "Room / Column / Cell"' });
              continue;
            }
            
            const qty = item.qty && typeof item.qty === 'number' && item.qty >= 1 ? item.qty : 1;
            let targetCellId: string | null = null;
            
            // Find cell_id from location
            const locationKey = item.location.toLowerCase().trim();
            targetCellId = locationToCellId.get(locationKey) || null;
            
            // Try partial matching if exact match fails
            if (!targetCellId) {
              // Try to match by room/column/cell separately
              const parts = locationKey.split('/').map((p: string) => p.trim());
              if (parts.length >= 3) {
                const roomName = parts[0];
                const columnName = parts[1];
                const cellCode = parts[2];
                
                // Find matching room
                const roomId = roomNameToId.get(roomName);
                if (roomId) {
                  const columns = columnsData?.filter(c => c.room_id === roomId);
                  const column = columns?.find(c => c.name.toLowerCase().trim() === columnName);
                  if (column) {
                    const cells = cellsData?.filter(c => c.column_id === column.id);
                    const cell = cells?.find(c => c.code.toLowerCase().trim() === cellCode);
                    if (cell) {
                      targetCellId = cell.id;
                    }
                  }
                }
              }
            }
            
            if (!targetCellId) {
              failedItems.push({ name: item.name, reason: `Location "${item.location}" not found. Please check the location format: "Room / Column / Cell"` });
              continue;
            }
            
            // Prepare remark with AI identifier
            let remarkValue: string | null = null;
            if (item.remark && typeof item.remark === 'string' && item.remark.trim()) {
              remarkValue = `${item.remark.trim()} [Added by AI]`;
            } else {
              remarkValue = '[Added by AI]';
            }
            
            // Insert item
            const { error: insertError } = await supabaseAuth
              .from('items_v2')
              .insert({
                household_id: householdId,
                cell_id: targetCellId,
                name: item.name.trim(),
                qty: qty,
                remark: remarkValue,
                expires_at: null, // Can be extended later if needed
                image_path: null,
              });
            
            if (insertError) {
              failedItems.push({ name: item.name, reason: insertError.message });
            } else {
              const location = item.location || 'default location';
              addedItems.push({ name: item.name, location });
            }
          }
          
          if (addedItems.length > 0) {
            operationResult = {
              success: true,
              action: 'add',
              count: addedItems.length,
              items: addedItems.map(i => i.name),
              message: `Successfully added ${addedItems.length} item(s): ${addedItems.map(i => `${i.name} (${i.location})`).join(', ')}`,
            };
            
            let resultMessage = actionData.reason || 'Items added';
            if (failedItems.length > 0) {
              resultMessage += `. ${failedItems.map(f => `${f.name}: ${f.reason}`).join('; ')}`;
            }
            response = `${resultMessage}. ${operationResult.message}`;
          } else if (failedItems.length > 0) {
            operationResult = {
              success: false,
              message: `Failed to add items: ${failedItems.map(f => `${f.name}: ${f.reason}`).join('; ')}`,
            };
            response = operationResult.message;
          }
        }
      }
    } catch (parseError) {
      // Not an action, continue with normal response
      console.log('Response is not an action, treating as regular response:', parseError);
    }

    return NextResponse.json({ 
      response,
      operation: operationResult,
    });
  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process chat request' },
      { status: 500 }
    );
  }
}
