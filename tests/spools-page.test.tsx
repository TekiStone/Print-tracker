import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SpoolsPage } from '../src/SpoolsPage'

describe('gestion des bobines', () => {
  it('affiche les statistiques et filtre par recherche', () => {
    render(<SpoolsPage />)

    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('1.46 kg')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Rechercher une bobine...'), { target: { value: 'Polymaker' } })

    expect(screen.getByText('Polymaker')).toBeInTheDocument()
    expect(screen.queryByText('Prusament')).not.toBeInTheDocument()
  })

  it('ajoute une bobine et la conserve dans le stockage local', () => {
    render(<SpoolsPage />)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une bobine/i }))
    fireEvent.change(screen.getByPlaceholderText('Ex. Prusament'), { target: { value: 'Filament Test' } })
    fireEvent.change(screen.getByPlaceholderText('Ex. Galaxy Black'), { target: { value: 'Bleu' } })
    fireEvent.change(screen.getByPlaceholderText('Ex. Boîte A · 03'), { target: { value: 'Boîte Z' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la bobine' }))

    expect(screen.getByText('Filament Test')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('print-tracker-spools') ?? '[]')).toHaveLength(5)
  })

  it('modifie puis retire une bobine après confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SpoolsPage />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Modifier' })[0])
    fireEvent.change(screen.getByPlaceholderText('Ex. Galaxy Black'), { target: { value: 'Noir modifié' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(screen.getByText('Noir modifié')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer' })[0])
    expect(screen.queryByText('Noir modifié')).not.toBeInTheDocument()
  })
})
