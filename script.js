let teamsData = [];

async function fetchLeaderboard() {
    try {
        const response = await fetch('unstop_all_teams.json');
        if (!response.ok) throw new Error('Network response was not ok');
        teamsData = await response.json();
        
        document.getElementById('total-teams').innerText = teamsData.length;
        renderTable(teamsData);
    } catch (error) {
        console.error('Error loading JSON:', error);
        document.getElementById('leaderboard-body').innerHTML = `
            <tr><td colspan="5" class="loading" style="color: red;">Failed to load 'unstop_all_teams.json'. Make sure it's in the same folder!</td></tr>
        `;
    }
}

function renderTable(data) {
    const tbody = document.getElementById('leaderboard-body');
    document.getElementById('visible-count').innerText = data.length;

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="no-data">No matching teams found.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(entry => {
        const team = entry.team || {};
        const players = team.players || [];
        
        const playersHtml = players.map(p => `
            <div class="player-item">
                <span class="player-name">${escapeHtml(p.name)}</span> 
                <span class="player-org">(${escapeHtml(p.organisation || 'N/A')})</span>
            </div>
        `).join('');

        return `
            <tr>
                <td><strong>#${escapeHtml(String(entry.rank))}</strong></td>
                <td class="team-name">${escapeHtml(team.team_name || 'Unknown')}</td>
                <td class="score">${escapeHtml(String(entry.score))}</td>
                <td>${playersHtml}</td>
                <td><small style="color: #64748b;">${escapeHtml(entry.finish_time || 'N/A')}</small></td>
            </tr>
        `;
    }).join('');
}

// Simple HTML escaper for safety
function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Live Search Filter
document.getElementById('search-input').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    
    const filtered = teamsData.filter(entry => {
        const teamName = (entry.team?.team_name || '').toLowerCase();
        const matchesTeam = teamName.includes(query);
        
        const matchesPlayers = (entry.team?.players || []).some(p => 
            p.name.toLowerCase().includes(query) || 
            (p.organisation || '').toLowerCase().includes(query)
        );

        return matchesTeam || matchesPlayers;
    });

    renderTable(filtered);
});

// Load data on startup
fetchLeaderboard();